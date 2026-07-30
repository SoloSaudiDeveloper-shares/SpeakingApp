import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consumeAudioUploadBudget: vi.fn(),
  uploadAudioStream: vi.fn(),
  deleteAudioObjectIfExists: vi.fn(),
  update: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('@/lib/auth/authorization', () => ({
  requireStudent: vi.fn(async () => ({
    ok: true,
    user: {
      id: 7,
      username: 'learner',
      role: 'Student',
      studentId: 11,
      displayName: 'Learner',
      mustChangePassword: false,
    },
  })),
  requireAuthenticated: vi.fn(),
  getAuthorizedAttempt: vi.fn(async () => ({
    attempt: {
      id: 42,
      studentId: 11,
      audioPath: null,
    },
    studentClass: 'A',
  })),
}));

vi.mock('@/lib/db', () => ({
  pool: { query: vi.fn() },
  db: {
    update: mocks.update,
  },
}));

vi.mock('@/lib/storage/audio-storage', () => ({
  uploadAudioStream: mocks.uploadAudioStream,
  deleteAudioObjectIfExists: mocks.deleteAudioObjectIfExists,
}));

vi.mock('@/lib/storage/audio-response', () => ({
  audioObjectResponse: vi.fn(),
}));

vi.mock('@/lib/security/resource-budget-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/resource-budget-server')>();
  return {
    ...actual,
    consumeAudioUploadBudget: mocks.consumeAudioUploadBudget,
  };
});

import { PUT } from '@/app/api/attempts/[id]/audio/route';
import {
  ResourceBudgetExceededError,
} from '@/lib/security/resource-budget-server';
import {
  MAX_AUDIO_BYTES,
  validatedAudioRequestStream,
} from '@/lib/storage/audio-validation';

function webmRequest(bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])) {
  return new Request('https://speaking.example/api/attempts/42/audio', {
    method: 'PUT',
    headers: { 'Content-Length': String(bytes.byteLength) },
    body: bytes,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.returning.mockResolvedValue([{ id: 42 }]);
  mocks.update.mockReturnValue({
    set: () => ({
      where: () => ({
        returning: mocks.returning,
      }),
    }),
  });
  mocks.uploadAudioStream.mockImplementation(async (_key, stream) => {
    for await (const _chunk of stream) {
      // Fully consume the validated stream as Blob storage does.
    }
  });
});

describe('attempt-bound audio upload budget', () => {
  test('reserves declared bytes before beginning the Blob write', async () => {
    const order: string[] = [];
    mocks.consumeAudioUploadBudget.mockImplementation(async () => {
      order.push('budget');
    });
    mocks.uploadAudioStream.mockImplementation(async (_key, stream) => {
      order.push('blob');
      for await (const _chunk of stream) {
        // Consume the stream.
      }
    });

    const response = await PUT(webmRequest(), {
      params: Promise.resolve({ id: '42' }),
    });

    expect(response.status).toBe(201);
    expect(order).toEqual(['budget', 'blob']);
    expect(mocks.consumeAudioUploadBudget).toHaveBeenCalledWith(
      7,
      4,
      expect.any(Date),
    );
  });

  test('returns 429 with Retry-After and never starts a Blob write when capped', async () => {
    mocks.consumeAudioUploadBudget.mockRejectedValueOnce(
      new ResourceBudgetExceededError('audio-upload-bytes', 3600),
    );

    const response = await PUT(webmRequest(), {
      params: Promise.resolve({ id: '42' }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
    expect(mocks.uploadAudioStream).not.toHaveBeenCalled();
  });

  test('rejects missing/oversized lengths and aborts before yielding bytes beyond the declaration', async () => {
    const missingLength = new Request(
      'https://speaking.example/api/attempts/42/audio',
      {
        method: 'PUT',
        body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      },
    );
    await expect(validatedAudioRequestStream(missingLength)).rejects.toThrow(
      'valid Content-Length',
    );

    const oversized = new Request(
      'https://speaking.example/api/attempts/42/audio',
      {
        method: 'PUT',
        headers: { 'Content-Length': String(MAX_AUDIO_BYTES + 1) },
        body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      },
    );
    await expect(validatedAudioRequestStream(oversized)).rejects.toThrow(
      'valid Content-Length',
    );

    const overDeclared = new Request(
      'https://speaking.example/api/attempts/42/audio',
      {
        method: 'PUT',
        headers: { 'Content-Length': '4' },
        body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]),
      },
    );
    const validated = await validatedAudioRequestStream(overDeclared);
    const yielded: Uint8Array[] = [];
    await expect((async () => {
      for await (const chunk of validated.stream) yielded.push(chunk);
    })()).rejects.toThrow('did not match Content-Length');
    expect(yielded).toHaveLength(0);
  });
});
