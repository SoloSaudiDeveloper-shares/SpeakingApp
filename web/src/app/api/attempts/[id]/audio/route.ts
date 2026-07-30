import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  getAuthorizedAttempt,
  requireAuthenticated,
  requireStudent,
} from '@/lib/auth/authorization';
import { db } from '@/lib/db';
import { attempts } from '@/lib/db/schema';
import { audioObjectResponse } from '@/lib/storage/audio-response';
import {
  deleteAudioObjectIfExists,
  uploadAudioStream,
} from '@/lib/storage/audio-storage';
import {
  audioExtension,
  validatedAudioRequestStream,
} from '@/lib/storage/audio-validation';
import {
  consumeAudioUploadBudget,
  resourceBudgetResponse,
} from '@/lib/security/resource-budget-server';

function positiveAttemptId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function readAttempt(
  params: Promise<{ id: string }>,
  roles?: readonly ('Admin' | 'Teacher' | 'Student')[],
) {
  const auth = await requireAuthenticated({ roles });
  if (!auth.ok) return { response: auth.response } as const;
  const { id } = await params;
  const attemptId = positiveAttemptId(id);
  if (!attemptId) {
    return { response: Response.json({ error: 'Invalid attempt ID.' }, { status: 400 }) } as const;
  }
  const row = await getAuthorizedAttempt(auth.user, attemptId);
  if (!row) {
    return { response: Response.json({ error: 'Attempt not found.' }, { status: 404 }) } as const;
  }
  return { auth, row, attemptId } as const;
}

async function serve(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  head: boolean,
) {
  try {
    const result = await readAttempt(params);
    if ('response' in result) return result.response;
    if (!result.row.attempt.audioPath) {
      return Response.json({ error: 'This attempt has no recording.' }, { status: 404 });
    }
    return audioObjectResponse(request, result.row.attempt.audioPath, { head });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return Response.json({ error: 'Recording not found.' }, { status: 404 });
    }
    console.error('[attempt-audio] Read failed.', {
      statusCode: (error as { statusCode?: number }).statusCode ?? null,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return Response.json({ error: 'Recording unavailable.' }, { status: 503 });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return serve(request, context, false);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return serve(request, context, true);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let uploadedKey: string | null = null;
  try {
    const studentAuth = await requireStudent();
    if (!studentAuth.ok) return studentAuth.response;
    const { id } = await params;
    const attemptId = positiveAttemptId(id);
    if (!attemptId) {
      return Response.json({ error: 'Invalid attempt ID.' }, { status: 400 });
    }

    const row = await getAuthorizedAttempt(studentAuth.user, attemptId);
    if (!row || row.attempt.studentId !== studentAuth.user.studentId) {
      return Response.json({ error: 'Attempt not found.' }, { status: 404 });
    }

    let body;
    try {
      body = await validatedAudioRequestStream(request);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Invalid audio body.' },
        { status: 415 },
      );
    }

    const reservedAt = new Date();
    await consumeAudioUploadBudget(
      studentAuth.user.id,
      body.contentLength,
      reservedAt,
    );

    const now = new Date();
    uploadedKey = [
      String(row.attempt.studentId),
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${attemptId}-${randomUUID()}.${audioExtension(body.contentType)}`,
    ].join('/');
    await uploadAudioStream(uploadedKey, body.stream, body.contentType);

    const [updated] = await db
      .update(attempts)
      .set({ audioPath: uploadedKey })
      .where(and(
        eq(attempts.id, attemptId),
        eq(attempts.studentId, row.attempt.studentId),
      ))
      .returning({ id: attempts.id });
    if (!updated) {
      await deleteAudioObjectIfExists(uploadedKey);
      return Response.json({ error: 'Attempt not found.' }, { status: 404 });
    }

    if (row.attempt.audioPath && row.attempt.audioPath !== uploadedKey) {
      void deleteAudioObjectIfExists(row.attempt.audioPath).catch(() => undefined);
    }
    return Response.json(
      { success: true, attemptId },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (uploadedKey) {
      await deleteAudioObjectIfExists(uploadedKey).catch(() => undefined);
    }
    const budgetResponse = resourceBudgetResponse(error);
    if (budgetResponse) return budgetResponse;
    console.error('[attempt-audio] Upload failed.', {
      statusCode: (error as { statusCode?: number }).statusCode ?? null,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return Response.json({ error: 'Recording upload failed.' }, { status: 503 });
  }
}
