const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function allowedHost(hostname = '') {
  const h = hostname.toLowerCase();
  return h === 'pipi.cn' || h.endsWith('.pipi.cn') || h === 'meituan.net' || h.endsWith('.meituan.net') || h === 'dpfile.com' || h.endsWith('.dpfile.com') || h === 'maoyan.com' || h.endsWith('.maoyan.com');
}

function upgradeTinyImage(u) {
  const h = u.hostname.toLowerCase();
  const isMaoyanCdn = h === 'pipi.cn' || h.endsWith('.pipi.cn') || h === 'meituan.net' || h.endsWith('.meituan.net');
  if (!isMaoyanCdn) return u;

  const search = String(u.search || '');
  const m = search.match(/imageView2\/(?:\d+)\/w\/(\d+)\/h\/(\d+)/i);
  if (m) {
    const w = Number(m[1]);
    const height = Number(m[2]);
    if (w <= 400 || height <= 600) {
      u.search = '?imageMogr2/quality/90';
    }
  }
  return u;
}

module.exports = async function handler(req, res) {
  try {
    const raw = String(req.query.url || '').trim();
    if (!raw) {
      res.statusCode = 400;
      return res.end('missing url');
    }

    let u = new URL(raw);
    if (u.protocol !== 'https:' || !allowedHost(u.hostname)) {
      res.statusCode = 403;
      return res.end('blocked host');
    }
    u = upgradeTinyImage(u);

    const upstream = await fetch(u.toString(), {
      headers: {
        'User-Agent': UA,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': 'https://m.maoyan.com/'
      },
      redirect: 'follow'
    });

    if (!upstream.ok) {
      res.statusCode = upstream.status;
      return res.end('upstream error');
    }

    const type = upstream.headers.get('content-type') || '';
    if (!type.startsWith('image/')) {
      res.statusCode = 415;
      return res.end('not image');
    }

    const length = Number(upstream.headers.get('content-length') || 0);
    if (length && length > 12 * 1024 * 1024) {
      res.statusCode = 413;
      return res.end('image too large');
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) {
      res.statusCode = 413;
      return res.end('image too large');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Image-Upstream', u.toString());
    res.end(buf);
  } catch (e) {
    res.statusCode = 502;
    res.end('media proxy failed');
  }
};
