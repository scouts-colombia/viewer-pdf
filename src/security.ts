const BLOCKED_PROTOCOLS = ['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'];
const PROD_ALLOWED_HOSTS = ['cdnscout.org'];
const DEV_ALLOWED_HOSTS = ['localhost', '127.0.0.1'];

export function validatePdfUrl(raw: string): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (BLOCKED_PROTOCOLS.includes(u.protocol)) return null;

    const host = u.hostname.toLowerCase();
    const prodOk =
      u.protocol === 'https:' &&
      PROD_ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
    const devOk =
      import.meta.env.DEV &&
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      DEV_ALLOWED_HOSTS.includes(host);

    return prodOk || devOk ? u : null;
  } catch {
    return null;
  }
}
