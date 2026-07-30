/**
 * Legacy unattached uploads are intentionally disabled. Audio must be uploaded
 * to PUT /api/attempts/:id/audio, which first verifies ownership and binds the
 * object to an existing attempt.
 */
export async function POST() {
  return Response.json(
    { error: 'Legacy audio upload is no longer available.' },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
