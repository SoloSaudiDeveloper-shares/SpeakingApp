const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORBIDDEN_FETCH_SITES = new Set(['cross-site']);

type RequestMetadata = Pick<Request, 'headers' | 'method' | 'url'>;

function configuredOrigins(): Set<string> {
  const values = [
    process.env.APP_ORIGIN,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  return new Set(values.flatMap((value) => {
    if (!value?.trim()) return [];
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  }));
}

function requestOrigins(request: RequestMetadata): Set<string> {
  const origins = configuredOrigins();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // An invalid request URL will be rejected later by the route itself.
  }
  return origins;
}

/**
 * Browser cookie-authenticated mutations must originate from this application.
 * Requests without browser Fetch Metadata/Origin headers remain available to
 * authenticated service clients; they do not receive ambient browser cookies.
 */
export function mutationRequestViolation(request: RequestMetadata): string | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite && FORBIDDEN_FETCH_SITES.has(fetchSite)) {
    return 'Cross-site mutation requests are not allowed.';
  }

  const origin = request.headers.get('origin');
  if (fetchSite === 'same-site' && !origin) {
    return 'Same-site mutation requests require an Origin header.';
  }
  if (!origin) return null;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return 'The request Origin header is invalid.';
  }

  if (!requestOrigins(request).has(normalizedOrigin)) {
    return 'The request origin is not allowed.';
  }
  return null;
}
