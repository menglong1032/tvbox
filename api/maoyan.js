const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

function decodeEntities(s = '') {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u002F/g, '/');
}

function stripTags(s = '') {
  return decodeEntities(String(s))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(regex, text, group = 1) {
  const m = String(text || '').match(regex);
  return m ? decodeEntities(String(m[group] || '').trim()) : '';
}

// IMPORTANT: Maoyan/Meituan image CDN often requires the original query or resize suffix.
// Do not strip them. The previous implementation removed those parts and produced 400s.
function normalizeImage(url = '') {
  let u = decodeEntities(String(url || '').trim()).replace(/\\\//g, '/');
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  return u;
}

function isContentImage(url = '') {
  return /(?:mediaplus|moviemachine|movie\/|basicdata)/i.test(url) &&
    !/festatic|logo|arrow|icon|scarlett/i.test(url);
}

function formatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '';
  const m = Math.floor(n / 60), s = Math.floor(n % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function fetchText(url, ua = MOBILE_UA, referer = 'https://www.maoyan.com/') {
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
  const showTime = stripTags(pick(/<div[^>]+class=["'][^"']*movie-show-time[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html));
  const score = scoreFromShare || pick(/<span[^>]+class=["'][^"']*score[^"']*["'][^>]*>([\d.]+)<\/span>/i, html);
  const scoreCount = pick(/([\d,]+)\s*人评/i, stripTags(html));
  const description = pick(/<meta\s+name=["']share:wechat:message:desc["']\s+content=["']简介\|([^"']*)["']/i, html) ||
    pick(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i, html);
  const poster = normalizeImage(pick(/<meta\s+name=["']share:wechat:message:icon["']\s+content=["']([^"']+)["']/i, html));
  const duration = Number(pick(/(\d+)\s*分钟/i, showTime + ' ' + stripTags(html))) || null;

  const actors = [];
  const actorRe = /<a\s+href=["']\/asgard\/celebrity\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = actorRe.exec(html))) {
    const id2 = am[1], block = am[2];
    const name2 = stripTags(block).replace(/\s*\/\s*$/, '').slice(0, 80);
    const avatar = normalizeImage(pick(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i, block));
    if (name2 && !actors.some(x => x.id === id2)) {
      actors.push({ id: id2, name: name2, avatar: isContentImage(avatar) ? avatar : '', url: `https://m.maoyan.com/asgard/celebrity/${id2}` });
    }
  }

  return {
    id: String(id), name, english_name: englishName, category, show_time: showTime,
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
  return String(name).replace(/介绍_图片_作品-猫眼电影.*$/i, '').replace(/介绍$/i, '').trim();
}

function parsePerson(html, id, sourceUrl) {
  const text = stripTags(html);
  let name = pick(/<h1[^>]*>([^<]{1,80})<\/h1>/i, html) || pick(/<title>([^_<]{1,80})/i, html);
  name = cleanPersonName(name);
  let avatar = normalizeImage(pick(/<meta[^>]+(?:property|name)=["'](?:og:image|share:wechat:message:icon)["'][^>]+content=["']([^"']+)["']/i, html));
  if (!avatar) {
    const cdn = [...String(html).matchAll(/https?:\\?\/\\?\/(?:p\d\.pipi\.cn|p\d\.meituan\.net)\/[A-Za-z0-9_\-/]+\.(?:jpg|jpeg|png)(?:[^"'\s<]*)?/gi)]
      .map(x => normalizeImage(x[0]))
      .filter(isContentImage);
    avatar = cdn[0] || '';
  }
  const en = pick(/(?:英文名|英文名称)[：:\s]*([^\s<]{2,60})/i, text) || '';
  const desc = pick(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html);
  return { id: String(id), name, english_name: en, avatar, description: desc, text_excerpt: text.slice(0, 1000), source_url: sourceUrl };
}

function parseAjaxExtra(html) {
  const text = stripTags(html), boxOffice = {};
  const re = /([\d.]+)\s*(万|亿)?\s*(首日票房|首周票房|累计票房|总票房)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = Number(m[1]), unit = m[2] || '', label = m[3];
    boxOffice[label] = { display: `${m[1]}${unit || '万'}`, value_wan: unit === '亿' ? raw * 10000 : raw };
  }
  function section(label, next) {
    const i = text.indexOf(label);
    if (i < 0) return '';
    let e = text.length;
    for (const n of next) {
      const p = text.indexOf(n, i + label.length);
      if (p >= 0 && p < e) e = p;
    }
    return text.slice(i + label.length, Math.min(e, i + label.length + 800)).trim();
  }
  return {
    box_office: boxOffice,
    publisher: section('出品发行', ['技术参数', '幕后花絮', '获奖', '荣誉']),
    tech_param: section('技术参数', ['幕后花絮', '获奖', '荣誉', '出品发行']),
    behind_the_scenes: section('幕后花絮', ['获奖', '荣誉', '出品发行', '技术参数']),
    raw_text_excerpt: text.slice(0, 3000)
  };
}

function parseGallery(html, movieId, sourceUrl) {
  const map = new Map(), raw = String(html || '');
  for (const m of raw.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const tag = m[0], u = normalizeImage(m[1]);
    if (!u || !isContentImage(u)) continue;
    const ctx = raw.slice(Math.max(0, (m.index || 0) - 300), Math.min(raw.length, (m.index || 0) + 420));
    if (/剧照|图集|movie-img|album|海报|poster/i.test(tag + ' ' + ctx)) {
      map.set(u, { url: u, type: /海报|poster/i.test(tag + ' ' + ctx) ? 'poster' : 'still', source_url: sourceUrl });
    }
  }
  return { movie_id: String(movieId), count: map.size, images: [...map.values()].slice(0, 40) };
}

function mergeGalleries(results, movieId) {
  const m = new Map();
  for (const r of results || []) for (const x of r?.images || []) if (x.url && isContentImage(x.url)) m.set(x.url, x);
  return { movie_id: String(movieId), count: m.size, images: [...m.values()] };
}

function extractBalanced(text, startIndex, open = '[', close = ']') {
  const src = String(text || '');
  let start = src.indexOf(open, startIndex);
  if (start < 0) return '';
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

function extractJsonArrayAfter(text, marker) {
  const idx = String(text || '').indexOf(marker);
  if (idx < 0) return null;
  const raw = extractBalanced(text, idx, '[', ']');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function parseEmbeddedVideoState(html, movieId, sourceUrl) {
  const raw = String(html || '');
  const types = extractJsonArrayAfter(raw, '"videoTypes":') || [];
  const feeds = extractJsonArrayAfter(raw, '"videoList":{"feeds":') || [];
  if (!feeds.length) return null;

  const typeCounts = {};
  for (const t of types) if (t && t.moduleName) typeCounts[t.moduleName] = Number(t.videoCount) || 0;

  const videos = [];
  for (const feed of feeds) {
    const video = feed?.video || {};
    const id = String(video.id || feed?.id || '');
    if (!id) continue;
    const typeDesc = String(video.typeDesc || '').trim();
    videos.push({
      video_id: id,
      title: String(feed?.title || feed?.shareInfo?.title || '').trim(),
      duration_seconds: Number(video.dur) || null,
      duration: formatDuration(video.dur),
      cover: normalizeImage(video.imgUrl || feed?.images?.[0]?.url || feed?.shareInfo?.img || ''),
      type: typeDesc === '预告片' ? 'trailer' : (typeDesc === '官方视频' ? 'official' : (/预告/.test(typeDesc) ? 'trailer' : 'official')),
      type_desc: typeDesc,
      direct_media_url: String(video.url || '').replace(/\\\//g, '/'),
      view_count: Number(video.viewCount) || 0,
      play_count: Number(video.viewCount) || 0,
      width: Number(video.width) || null,
      height: Number(video.height) || null,
      source_page_url: `https://m.maoyan.com/asgard/movie/${movieId}/preview?_v_=yes&videoId=${id}`,
      source_url: sourceUrl
    });
  }

  return {
    movie_id: String(movieId),
    count: videos.length,
    trailer_count: typeCounts['预告片'] || videos.filter(v => v.type === 'trailer').length,
    official_count: typeCounts['官方视频'] || 0,
    videos,
    video_types: types.map(t => ({ id: t.moduleId || t.id, name: t.moduleName || t.name, count: Number(t.videoCount) || 0, cover: normalizeImage(t.videoImage || '') })),
    source_url: sourceUrl,
    parser: 'embedded_videoList.feeds'
  };
}

function parseVideoHtmlFallback(html, movieId, sourceUrl) {
  const raw = String(html || ''), text = stripTags(raw), videos = [], seen = new Set();
  const trailerCount = Number(pick(/预告片\s*(\d+)/, text)) || 0;
  const officialCount = Number(pick(/官方视频\s*(\d+)/, text)) || 0;
  const re = /<li[^>]+class=["'][^"']*video-item[^"']*["'][^>]+data-id=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const id = m[1], block = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const label = stripTags(pick(/<span[^>]+class=["'][^"']*label[^"']*["'][^>]*>([^<]*)<\/span>/i, block));
    const duration = stripTags(pick(/<span[^>]+class=["'][^"']*txt[^"']*["'][^>]*>([^<]*)<\/span>/i, block));
    const title = stripTags(pick(/<div[^>]+class=["'][^"']*main-title[^"']*["'][^>]*>([^<]*)<\/div>/i, block));
    const cover = normalizeImage(pick(/<img[^>]+class=["'][^"']*movie-img[^"']*["'][^>]+src=["']([^"']+)["']/i, block));
    videos.push({
      video_id: id, title, duration, cover,
      type: /预告/.test(label) ? 'trailer' : 'official',
      type_desc: label,
      direct_media_url: null,
      view_count: 0,
      play_count: 0,
      source_page_url: `https://m.maoyan.com/asgard/movie/${movieId}/preview?_v_=yes&videoId=${id}`,
      source_url: sourceUrl
    });
  }
  return {
    movie_id: String(movieId), count: videos.length,
    trailer_count: trailerCount || videos.filter(v => v.type === 'trailer').length,
    official_count: officialCount || videos.filter(v => v.type === 'official').length,
    videos, source_url: sourceUrl, parser: 'html_video_items'
  };
}

function trailerRank(v) {
  if (v.type !== 'trailer') return 100;
  const t = String(v.title || '');
  if (/首支预告|首曝预告|首支/.test(t)) return 0;
  if (/正式预告|终极预告|定档预告/.test(t)) return 1;
  if (/第二支预告|IMAX预告|预告/.test(t) && !/番外|花絮|彩蛋|片段/.test(t)) return 2;
  if (/番外|花絮|彩蛋|片段|幕后/.test(t)) return 8;
  return 4;
}

function mergeVideoResults(results, movieId) {
  const map = new Map();
  let trailerCount = 0, officialCount = 0;
  const parsers = [];
  for (const r of results) {
    if (!r || !Array.isArray(r.videos)) continue;
    trailerCount = Math.max(trailerCount, r.trailer_count || 0);
    officialCount = Math.max(officialCount, r.official_count || 0);
    if (r.parser) parsers.push(r.parser);
    for (const v of r.videos) {
      const old = map.get(v.video_id) || {};
      map.set(v.video_id, {
        ...old, ...v,
        title: v.title || old.title || '',
        cover: v.cover || old.cover || '',
        duration: v.duration || old.duration || '',
        duration_seconds: v.duration_seconds || old.duration_seconds || null,
        direct_media_url: v.direct_media_url || old.direct_media_url || null,
        view_count: v.view_count || old.view_count || 0,
        play_count: v.play_count || old.play_count || 0,
        type: v.type || old.type || 'official',
        type_desc: v.type_desc || old.type_desc || ''
      });
    }
  }
  const videos = [...map.values()].sort((a, b) => {
    const typeDiff = (a.type === 'trailer' ? 0 : 1) - (b.type === 'trailer' ? 0 : 1);
    if (typeDiff) return typeDiff;
    const rankDiff = trailerRank(a) - trailerRank(b);
    if (rankDiff) return rankDiff;
    return (b.play_count || 0) - (a.play_count || 0);
  });
  return {
    movie_id: String(movieId), count: videos.length,
    trailer_count: trailerCount || videos.filter(v => v.type === 'trailer').length,
    official_count: officialCount || videos.filter(v => v.type === 'official').length,
    videos,
    parsers: [...new Set(parsers)]
  };
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  const action = String(req.query.action || 'status');
  const fetchedAt = new Date().toISOString();
  try {
    if (action === 'status') {
      return json(res, 200, { ok: true, provider: 'maoyan', status: 'ACTIVE', fetched_at: fetchedAt, capabilities: ['search', 'detail', 'people', 'images', 'boxoffice', 'videos'] });
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

    if (action === 'people') {
      const ids = String(req.query.ids || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)).slice(0, 10);
      if (!ids.length) return json(res, 400, { ok: false, error: 'missing ids' });
      const people = await Promise.all(ids.map(async id => {
        const urls = [
          `https://qqw.maoyan.com/asgard/celebrity/${id}`,
          `https://m.maoyan.com/asgard/celebrity/${id}`,
          `https://piaofang.maoyan.com/celebrity?id=${id}`
        ];
        for (const u of urls) {
          try {
            const p = parsePerson(await fetchText(u, u.includes('piaofang') ? DESKTOP_UA : MOBILE_UA, u.includes('piaofang') ? 'https://piaofang.maoyan.com/' : 'https://m.maoyan.com/'), id, u);
            if (p.name && !/登录-猫眼电影/.test(p.name)) return p;
          } catch {}
        }
        return { id, name: '', avatar: '', error: 'all person sources failed' };
      }));
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, people });
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

    if (action === 'images') {
      const urls = [
        `https://imovie.pipi.cn/films/${id}`,
        `https://www.maoyan.com/films/${id}`,
        `https://m.maoyan.com/asgard/movie/${id}`
      ];
      const rs = await Promise.allSettled(urls.map((u, i) => fetchText(u, i === 2 ? MOBILE_UA : DESKTOP_UA)));
      const parsed = rs.map((r, i) => r.status === 'fulfilled' ? parseGallery(r.value, id, urls[i]) : null).filter(Boolean);
      const merged = mergeGalleries(parsed, id);
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, ...merged, sources: rs.map((r, i) => ({ url: urls[i], status: r.status })) });
    }

    if (action === 'videos') {
      const urls = [
        `https://qqw.maoyan.com/asgard/movie/${id}/preview`,
        `https://m.maoyan.com/asgard/movie/${id}/preview`
      ];
      const rs = await Promise.allSettled(urls.map(u => fetchText(u, MOBILE_UA, `https://m.maoyan.com/asgard/movie/${id}`)));
      const parsed = [];
      rs.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const embedded = parseEmbeddedVideoState(r.value, id, urls[i]);
          parsed.push(embedded || parseVideoHtmlFallback(r.value, id, urls[i]));
        }
      });
      if (!parsed.length) throw new Error('all video sources failed');
      const merged = mergeVideoResults(parsed, id);
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, ...merged, sources: urls, source_status: rs.map((r, i) => ({ url: urls[i], status: r.status, error: r.status === 'rejected' ? String(r.reason) : '' })) });
    }

    return json(res, 404, { ok: false, error: `unknown action: ${action}` });
  } catch (error) {
    return json(res, 502, { ok: false, provider: 'maoyan', action, status: 'FETCH_FAILED', fetched_at: fetchedAt, latency_ms: Date.now() - started, error: error && error.message ? error.message : String(error) });
  }
};
