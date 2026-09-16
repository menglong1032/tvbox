const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.end(JSON.stringify(body));
}

function stripTags(s = '') {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(regex, text, group = 1) {
  const m = String(text || '').match(regex);
  return m ? String(m[group] || '').trim() : '';
}

async function fetchText(url, ua = MOBILE_UA) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
      'Referer': 'https://www.maoyan.com/'
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
      poster: value.img || value.poster || value.pic || '',
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
  const showTime = stripTags(pick(/<div[^>]+class=["'][^"']*movie-show-time[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html));
  const score = scoreFromShare || pick(/<span[^>]+class=["'][^"']*score[^"']*["'][^>]*>([\d.]+)<\/span>/i, html);
  const scoreCount = pick(/([\d,]+)\s*人评/i, stripTags(html));
  const description = pick(/<meta\s+name=["']share:wechat:message:desc["']\s+content=["']简介\|([^"']*)["']/i, html) || pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i, html);
  const poster = pick(/<meta\s+name=["']share:wechat:message:icon["']\s+content=["']([^"']+)["']/i, html);
  const duration = Number(pick(/(\d+)\s*分钟/i, showTime + ' ' + stripTags(html))) || null;

  const actorBlock = pick(/<div[^>]+class=["'][^"']*actors[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html);
  const actors = [];
  const actorRe = /<a\s+href=["']\/asgard\/celebrity\/(\d+)["'][^>]*>([^<]+)<\/a>/gi;
  let am;
  while ((am = actorRe.exec(actorBlock))) {
    actors.push({ id: am[1], name: stripTags(am[2]), url: `https://m.maoyan.com/asgard/celebrity/${am[1]}` });
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
    actors,
    source_url: `https://m.maoyan.com/asgard/movie/${id}`
  };
}

function parseAjaxExtra(html) {
  const text = stripTags(html);
  const boxOffice = {};
  const re = /([\d.]+)\s*(万|亿)?\s*(首日票房|首周票房|累计票房|总票房)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = Number(m[1]);
    const unit = m[2] || '';
    const label = m[3];
    let wan = raw;
    if (unit === '亿') wan = raw * 10000;
    if (unit === '万' || !unit) wan = raw;
    boxOffice[label] = { display: `${m[1]}${unit || '万'}`, value_wan: wan };
  }

  function section(label, nextLabels) {
    const idx = text.indexOf(label);
    if (idx < 0) return '';
    let end = text.length;
    for (const n of nextLabels) {
      const p = text.indexOf(n, idx + label.length);
      if (p >= 0 && p < end) end = p;
    }
    return text.slice(idx + label.length, Math.min(end, idx + label.length + 800)).trim();
  }

  return {
    box_office: boxOffice,
    publisher: section('出品发行', ['技术参数', '幕后花絮', '获奖', '荣誉']),
    tech_param: section('技术参数', ['幕后花絮', '获奖', '荣誉', '出品发行']),
    behind_the_scenes: section('幕后花絮', ['获奖', '荣誉', '出品发行', '技术参数']),
    raw_text_excerpt: text.slice(0, 3000)
  };
}

function parseVideos(html, movieId) {
  const list = [];
  const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*(?:videoId=|\/preview\?videoId=)(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const block = m[3];
    const title = stripTags(block).replace(/^\d{1,2}:\d{2}\s*/, '').slice(0, 160);
    const duration = pick(/\b(\d{1,2}:\d{2})\b/, stripTags(block));
    const cover = pick(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i, block);
    const href = m[1].startsWith('http') ? m[1] : `https://www.maoyan.com${m[1]}`;
    list.push({ video_id: m[2], title, duration, cover, source_page_url: href, direct_media_url: null });
  }

  if (!list.length) {
    const ids = [...String(html).matchAll(/videoId=(\d+)/g)].map(x => x[1]);
    for (const id of [...new Set(ids)].slice(0, 60)) {
      list.push({ video_id: id, title: '', duration: '', cover: '', source_page_url: `https://m.maoyan.com/asgard/feedVideos/index?videoId=${id}`, direct_media_url: null });
    }
  }
  return { movie_id: String(movieId), count: list.length, videos: list };
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  const action = String(req.query.action || 'status');
  const fetchedAt = new Date().toISOString();
  try {
    if (action === 'status') {
      return json(res, 200, { ok: true, provider: 'maoyan', status: 'ACTIVE', fetched_at: fetchedAt, capabilities: ['search','detail','boxoffice','videos'] });
    }

    if (action === 'search') {
      const q = String(req.query.q || '').trim();
      if (!q) return json(res, 400, { ok: false, error: 'missing q' });
      const url = `https://m.maoyan.com/apollo/ajax/search?kw=${encodeURIComponent(q)}&cityId=1&stype=-1`;
      const text = await fetchText(url);
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('search response is not JSON'); }
      const movies = collectMovies(data).slice(0, 30);
      return json(res, 200, { ok: true, provider: 'maoyan', action, query: q, fetched_at: fetchedAt, latency_ms: Date.now() - started, count: movies.length, movies, source_url: url });
    }

    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return json(res, 400, { ok: false, error: 'missing/invalid id' });

    if (action === 'detail') {
      const mobileUrl = `https://m.maoyan.com/asgard/movie/${id}`;
      const ajaxUrl = `https://www.maoyan.com/ajax/films/${id}`;
      const [detailR, extraR] = await Promise.allSettled([
        fetchText(mobileUrl, MOBILE_UA),
        fetchText(ajaxUrl, DESKTOP_UA)
      ]);
      if (detailR.status !== 'fulfilled') throw detailR.reason;
      const detail = parseDetail(detailR.value, id);
      const extra = extraR.status === 'fulfilled' ? parseAjaxExtra(extraR.value) : { box_office: {}, publisher: '', tech_param: '', behind_the_scenes: '', error: String(extraR.reason || '') };
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, movie: { ...detail, ...extra }, sources: { detail: mobileUrl, extra: ajaxUrl } });
    }

    if (action === 'videos') {
      const url = `https://m.maoyan.com/asgard/movie/${id}/preview`;
      const html = await fetchText(url, MOBILE_UA);
      const parsed = parseVideos(html, id);
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, ...parsed, source_url: url });
    }

    return json(res, 404, { ok: false, error: `unknown action: ${action}` });
  } catch (error) {
    return json(res, 502, { ok: false, provider: 'maoyan', action, status: 'FETCH_FAILED', fetched_at: fetchedAt, latency_ms: Date.now() - started, error: error && error.message ? error.message : String(error) });
  }
};
