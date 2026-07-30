import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { Readable } from 'node:stream';

const CONTAINER_NAME = process.env.AZURE_AUDIO_CONTAINER?.trim() || 'speaking-audio';

function serviceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  if (connectionString) return BlobServiceClient.fromConnectionString(connectionString);

  const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL?.trim();
  if (!accountUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AZURE_STORAGE_ACCOUNT_URL is required in production.');
    }
    return BlobServiceClient.fromConnectionString('UseDevelopmentStorage=true');
  }

  const developmentKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim();
  if (developmentKey && process.env.NODE_ENV !== 'production') {
    const accountName = new URL(accountUrl).hostname.split('.')[0];
    return new BlobServiceClient(accountUrl, new StorageSharedKeyCredential(accountName, developmentKey));
  }
  return new BlobServiceClient(accountUrl, new DefaultAzureCredential());
}

let client: BlobServiceClient | undefined;

function container() {
  client ??= serviceClient();
  return client.getContainerClient(CONTAINER_NAME);
}

export function normalizeAudioObjectKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.split('/').some((part) => !part)) {
    throw new Error('Invalid audio object key.');
  }
  return normalized;
}

export async function uploadAudioObject(key: string, data: Buffer, contentType: string) {
  const safeKey = normalizeAudioObjectKey(key);
  const containerClient = container();
  await containerClient.createIfNotExists();
  await containerClient.getBlockBlobClient(safeKey).uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
  });
  return safeKey;
}

export async function uploadAudioStream(
  key: string,
  data: Readable,
  contentType: string,
) {
  const safeKey = normalizeAudioObjectKey(key);
  const containerClient = container();
  await containerClient.createIfNotExists();
  await containerClient.getBlockBlobClient(safeKey).uploadStream(
    data,
    4 * 1024 * 1024,
    2,
    { blobHTTPHeaders: { blobContentType: contentType } },
  );
  return safeKey;
}

export async function getAudioObjectProperties(key: string) {
  const safeKey = normalizeAudioObjectKey(key);
  const properties = await container().getBlobClient(safeKey).getProperties();
  return {
    contentLength: properties.contentLength ?? 0,
    contentType: properties.contentType,
    etag: properties.etag,
    lastModified: properties.lastModified,
  };
}

export async function streamAudioObject(
  key: string,
  range?: { offset: number; count: number },
) {
  const safeKey = normalizeAudioObjectKey(key);
  const response = await container().getBlobClient(safeKey).download(
    range?.offset,
    range?.count,
  );
  if (!response.readableStreamBody) throw new Error('Audio blob did not contain a body.');
  return Readable.toWeb(response.readableStreamBody as Readable) as ReadableStream<Uint8Array>;
}

export async function deleteAudioObjectIfExists(key: string) {
  const safeKey = normalizeAudioObjectKey(key);
  await container().getBlobClient(safeKey).deleteIfExists();
}

export async function downloadAudioObject(key: string) {
  const safeKey = normalizeAudioObjectKey(key);
  const response = await container().getBlobClient(safeKey).download();
  if (!response.readableStreamBody) throw new Error('Audio blob did not contain a body.');
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) chunks.push(Buffer.from(chunk));
  return {
    data: Buffer.concat(chunks),
    contentType: response.contentType || 'application/octet-stream',
  };
}
