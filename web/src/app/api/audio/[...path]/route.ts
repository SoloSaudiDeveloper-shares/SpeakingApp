import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import path from 'path';
import fs from 'fs';
import { getSessionFromToken } from '@/lib/actions/auth-actions';

function audioArchiveDir() {
  return process.env.SPEAKING_LAB_AUDIO_DIR
    ? path.resolve(process.env.SPEAKING_LAB_AUDIO_DIR)
    : path.resolve(path.join(process.cwd(), '..', 'audio-archive'));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session-token')?.value;
    if (!token) return new Response('Not authenticated', { status: 401 });
    const user = await getSessionFromToken(token);
    if (!user) return new Response('Not authenticated', { status: 401 });

    const { path: segments } = await params;
    const base = audioArchiveDir();
    const filePath = path.join(base, ...segments);

    // Security: prevent directory traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!fs.existsSync(resolved)) {
      return new Response('Not found', { status: 404 });
    }

    const buffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
    };

    return new Response(buffer, {
      headers: {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch {
    return new Response('Internal server error', { status: 500 });
  }
}
