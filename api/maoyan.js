const trailers = require('./trailers');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function decode(s = '') {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u002F/g, '/');
}

function strip(s = '') {
  return decode(String(s))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(re, text, group = 1) {
  const m = String(text || '').match(re);
  return m ? decode(String(m[group] || '').trim()) : '';
}

function normalizeImage(url = '') {
  let u = decode(String(url || '').trim()).replace(/\\\//g, '/');
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return u;
}

function isImage(url = '') {
  return /^https:\/\/(?:p\d\.pipi\.cn|p\d\.meituan\.net|img\.meituan\.net)\//i.test(url) &&
    !/festatic|logo|arrow|icon|scarlett/i.test(url);
}

async function getText(url, ua = MOBILE_UA, referer = 'https://m.maoyan.com/') {
  const r = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
      'Referer': referer
    },
    redirect: 'follow'
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return text;
}

function collectMovies(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectMovies(item, out, seen);
    return out;
  }
  const id = value.id || value.movieId || value.movieid;
  const name = value.nm || value.name || value.movieName || value.title;
  if (id && name && !seen.has(String(id))) {
    seen.add(String(id));
    out.push({
      id: String(id),
      name: String(name),
      english_name: value.enm || value.enName || '',
      poster: normalizeImage(value.img || value.poster || value.pic || ''),
      category: value.cat || value.type || '',
      director: value.dir || '',
      actors: value.star || value.actors || '',
      release_date: value.rt || value.releaseDate || value.showInfo || '',
      duration: value.dur || value.duration || '',
      score: value.sc ?? value.score ?? null,
      wish: value.wish ?? null
    });
  }
  for (const v of Object.values(value)) collectMovies(v, out, seen);
  return out;
}

function parseDetail(html, id) {
  let name = pick(/<meta\s+name=["']share:wechat:message:title["']\s+content=["']《([^》]+)》/i, html);
  const scoreFromShare = pick(/<meta\s+name=["']share:wechat:message:title["']\s+content=["'][^"']*猫眼购票评分([\d.]+)/i, html);
  if (!name) name = pick(/<div[^>]+class=["'][^"']*movie-cn-name[^"']*["'][^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i, html);
  if (!name) name = pick(/<title>([^_<]+)_购票/i, html);

  const englishName = pick(/<div[^>]+class=["'][^"']*movie-en-name[^"']*["'][^>]*>([^<]*)<\/div>/i, html);
  const category = pick(/<span[^>]+class=["'][^"']*movie-cat[^"']*["'][^>]*>([^<]+)<\/span>/i, html);
  const showTime = strip(pick(/<div[^>]+class=["'][^"']*movie-show-time[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html));
  const score = scoreFromShare || pick(/<span[^>]+class=["'][^"']*score[^"']*["'][^>]*>([\d.]+)<\/span>/i, html);
  const scoreCount = pick(/([\d,]+)\s*人评/i, strip(html));
  const description = pick(/<meta\s+name=["']share:wechat:message:desc["']\s+content=["']简介\|([^"']*)["']/i, html) ||
    pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i, html);
  const poster = normalizeImage(pick(/<meta\s+name=["']share:wechat:message:icon["']\s+content=["']([^"']+)["']/i, html));
  const duration = Number(pick(/(\d+)\s*分钟/i, `${showTime} ${strip(html)}`)) || null;

  const actors = [];
  const actorRe = /<a\s+href=["']\/asgard\/celebrity\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = actorRe.exec(html))) {
    const personId = m[1];
    const block = m[2];
    const personName = strip(block).replace(/\s*\/\s*$/, '').slice(0, 80);
    const avatar = normalizeImage(pick(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i, block));
    if (personName && !actors.some(x => x.id === personId)) {
      actors.push({
        id: personId,
        name: personName,
        avatar: isImage(avatar) ? avatar : '',
        url: `https://m.maoyan.com/asgard/celebrity/${personId}`
      });
    }
  }

  return {
    id: String(id),
    name,
    english_name: englishName,
    category,
    show_time: showTime,
    duration_min: duration,
    score: score ? Number(score) : null,
    score_count: scoreCount ? Number(scoreCount.replace(/,/g, '')) : null,
    description,
    poster,
    poster_hd: poster,
    actors: actors.slice(0, 20),
    source_url: `https://m.maoyan.com/asgard/movie/${id}`
  };
}

function cleanPersonName(name = '') {
  return String(name)
    .replace(/介绍_图片_作品-猫眼电影.*$/i, '')
    .replace(/介绍$/i, '')
    .trim();
}

function parsePerson(html, id, sourceUrl) {
  const bodyText = strip(html);
  let name = pick(/<h1[^>]*>([^<]{1,80})<\/h1>/i, html) || pick(/<title>([^_<]{1,80})/i, html);
  name = cleanPersonName(name);

  let avatar = normalizeImage(
    pick(/<meta[^>]+(?:property|name)=["'](?:og:image|share:wechat:message:icon)["'][^>]+content=["']([^"']+)["']/i, html)
  );

  if (!isImage(avatar)) {
    const candidates = [...String(html).matchAll(/https?:\\?\/\\?\/(?:p\d\.pipi\.cn|p\d\.meituan\.net|img\.meituan\.net)\/[A-Za-z0-9_\-/.]+\.(?:jpg|jpeg|png)(?:[^"'\s<]*)?/gi)]
      .map(x => normalizeImage(x[0]))
      .filter(isImage);
    avatar = candidates[0] || '';
  }

  return {
    id: String(id),
    name,
    avatar,
    description: pick(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html),
    text_excerpt: bodyText.slice(0, 900),
    source_url: sourceUrl
  };
}

function collectImages(html, sourceUrl) {
  const raw = String(html || '');
  const map = new Map();
  for (const m of raw.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const url = normalizeImage(m[1]);
    if (!isImage(url)) continue;
    const context = raw.slice(Math.max(0, (m.index || 0) - 260), Math.min(raw.length, (m.index || 0) + 360));
    if (/剧照|图集|movie-img|album|海报|poster/i.test(m[0] + context)) {
      map.set(url, {
        url,
        type: /海报|poster/i.test(m[0] + context) ? 'poster' : 'still',
        source_url: sourceUrl
      });
    }
  }
  return [...map.values()];
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  const action = String(req.query.action || 'status');
  const fetchedAt = new Date().toISOString();

  if (action === 'videos') {
    return trailers(req, res);
  }

  try {
    if (action === 'status') {
      return send(res, 200, {
        ok: true,
        provider: 'maoyan',
        status: 'ACTIVE',
        fetched_at: fetchedAt,
        capabilities: ['search', 'detail', 'people', 'images', 'videos']
      });
    }

    if (action === 'search') {
      const q = String(req.query.q || '').trim();
      if (!q) return send(res, 400, { ok: false, error: 'missing q' });
      const sourceUrl = `https://m.maoyan.com/apollo/ajax/search?kw=${encodeURIComponent(q)}&cityId=1&stype=-1`;
      const raw = await getText(sourceUrl);
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error('search response is not JSON'); }
      const movies = collectMovies(data).slice(0, 30);
      return send(res, 200, {
        ok: true,
        provider: 'maoyan',
        action,
        query: q,
        fetched_at: fetchedAt,
        latency_ms: Date.now() - started,
        count: movies.length,
        movies,
        source_url: sourceUrl
      });
    }

    if (action === 'people') {
      const ids = String(req.query.ids || '')
        .split(',')
        .map(x => x.trim())
        .filter(x => /^\d+$/.test(x))
        .slice(0, 20);
      if (!ids.length) return send(res, 400, { ok: false, error: 'missing ids' });

      const people = await Promise.all(ids.map(async id => {
        const sources = [
          `https://qqw.maoyan.com/asgard/celebrity/${id}`,
          `https://m.maoyan.com/asgard/celebrity/${id}`,
          `https://piaofang.maoyan.com/celebrity?id=${id}`
        ];
        for (const sourceUrl of sources) {
          try {
            const html = await getText(
              sourceUrl,
              sourceUrl.includes('piaofang') ? DESKTOP_UA : MOBILE_UA,
              sourceUrl.includes('piaofang') ? 'https://piaofang.maoyan.com/' : 'https://m.maoyan.com/'
            );
            const person = parsePerson(html, id, sourceUrl);
            if (person.name && !/登录-猫眼电影/.test(person.name)) return person;
          } catch {}
        }
        return { id, name: '', avatar: '', error: 'all person sources failed' };
      }));

      return send(res, 200, {
        ok: true,
        provider: 'maoyan',
        action,
        fetched_at: fetchedAt,
        latency_ms: Date.now() - started,
        people
      });
    }

    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return send(res, 400, { ok: false, error: 'missing/invalid id' });

    if (action === 'detail') {
      const sourceUrl = `https://m.maoyan.com/asgard/movie/${id}`;
      const html = await getText(sourceUrl, MOBILE_UA, 'https://m.maoyan.com/');
      const movie = parseDetail(html, id);
      return send(res, 200, {
        ok: true,
        provider: 'maoyan',
        action,
        fetched_at: fetchedAt,
        latency_ms: Date.now() - started,
        movie,
        sources: { detail: sourceUrl }
      });
    }

    if (action === 'images') {
      const sources = [
        `https://imovie.pipi.cn/films/${id}`,
        `https://www.maoyan.com/films/${id}`,
        `https://m.maoyan.com/asgard/movie/${id}`
      ];
      const settled = await Promise.allSettled(sources.map((url, i) => getText(url, i === 2 ? MOBILE_UA : DESKTOP_UA)));
      const map = new Map();
      settled.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        for (const item of collectImages(r.value, sources[i])) map.set(item.url, item);
      });
      const images = [...map.values()].slice(0, 40);
      return send(res, 200, {
        ok: true,
        provider: 'maoyan',
        action,
        movie_id: id,
        fetched_at: fetchedAt,
        latency_ms: Date.now() - started,
        count: images.length,
        images,
        sources: settled.map((r, i) => ({ url: sources[i], status: r.status }))
      });
    }

    return send(res, 404, { ok: false, error: `unknown action: ${action}` });
  } catch (error) {
    return send(res, 502, {
      ok: false,
      provider: 'maoyan',
      action,
      status: 'FETCH_FAILED',
      fetched_at: fetchedAt,
      latency_ms: Date.now() - started,
      error: error && error.message ? error.message : String(error)
    });
  }
};
