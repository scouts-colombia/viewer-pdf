/**
 * r2-download-cleaner — con CORS para viewer.cdnscout.org
 *
 * Para actualizar:
 *   Cloudflare Dashboard → Workers & Pages → r2-download-cleaner → Edit code → pegar este archivo
 */

const ALLOWED_ORIGINS = [
  'https://viewer.cdnscout.org',
  'https://scout.org.co',
  'http://localhost:4321',
  'http://localhost:5173',
  'http://localhost:3000',
];

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, If-None-Match, If-Modified-Since',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, ETag, Accept-Ranges, Content-Disposition',
    'Access-Control-Max-Age': '86400',
  };
}

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : undefined;
  const end   = m[2] ? Number(m[2]) : undefined;
  if (start === undefined && end === undefined) return null;
  if (start !== undefined && end !== undefined && end < start) return null;
  if (start !== undefined && !Number.isSafeInteger(start)) return null;
  if (end !== undefined && !Number.isSafeInteger(end)) return null;
  if (start === undefined && end === 0) return null;
  if (start !== undefined && end !== undefined) return { offset: start, length: end - start + 1 };
  if (start !== undefined) return { offset: start };
  return { suffix: end };
}

function cleanDownloadName(name, fallback) {
  const cleaned = name
    .replace(/[_]+/g, ' ')
    .replace(/[\r\n"\\/:*?<>|\x00-\x1f\x7f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return cleaned || fallback;
}

function contentDisposition(type, filename) {
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${filename}"; filename*=UTF-8''${encoded}`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors   = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Método no permitido', {
        status: 405,
        headers: {
          ...cors,
          'Allow': 'GET, HEAD, OPTIONS',
        },
      });
    }

    const url            = new URL(request.url);
    const key            = url.pathname.slice(1);
    const downloadName   = url.searchParams.get('download');
    const allowedExtensions = ['.pdf', '.xlsx', '.doc', '.docx'];
    const fileExtension  = key.slice(key.lastIndexOf('.')).toLowerCase();

    if (!key) {
      return new Response('Archivo no especificado', { status: 400, headers: cors });
    }

    // Soportar Range requests (pdf.js carga el PDF en chunks)
    const rangeHeader = request.headers.get('Range');
    const range       = rangeHeader ? parseRange(rangeHeader) : undefined;
    if (range === null) {
      return new Response('Rango inválido', {
        status: 416,
        headers: {
          ...cors,
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes */*',
        },
      });
    }

    const object      = range
      ? await env.MY_BUCKET.get(key, { range })
      : await env.MY_BUCKET.get(key);

    if (object === null) {
      return new Response('Archivo no encontrado', { status: 404, headers: cors });
    }

    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');

    if (downloadName && allowedExtensions.includes(fileExtension)) {
      const fallbackName = key.split('/').pop() || 'documento';
      const cleanName = cleanDownloadName(downloadName, fallbackName);
      headers.set(
        'Content-Disposition',
        contentDisposition(url.searchParams.has('force') ? 'attachment' : 'inline', cleanName)
      );
    }

    // Range response
    if (range && object.range) {
      const { offset, length } = object.range;
      headers.set(
        'Content-Range',
        `bytes ${offset}-${offset + length - 1}/${object.size}`
      );
      return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
    }

    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  },
};
