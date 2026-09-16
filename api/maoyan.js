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
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\\u002F/g, '/');
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

function hdImage(url = '') {
  let u = decodeEntities(String(url || '').trim());
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  // 猫眼 / pipi CDN 的移动页常附带 118x166 等裁剪参数，去掉即可回到原始资源。
  if (/pipi\.cn|meituan\.net|maoyan\.com/i.test(u)) {
    u = u.split('?')[0].replace(/@\d+w_\d+h.*$/i, '');
  }
  return u;
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
      poster: hdImage(value.img || value.poster || value.pic || ''),
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
  const poster = hdImage(pick(/<meta\s+name=["']share:wechat:message:icon["']\s+content=["']([^"']+)["']/i, html));
  const duration = Number(pick(/(\d+)\s*分钟/i, showTime + ' ' + stripTags(html))) || null;

  const actorBlock = pick(/<div[^>]+class=["'][^"']*actors[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, html);
  const actors = [];
  const actorRe = /<a\s+href=["']\/asgard\/celebrity\/(\d+)["'][^>]*>([^<]+)<\/a>/gi;
  let am;
  while ((am = actorRe.exec(actorBlock))) {
    actors.push({ id: am[1], name: stripTags(am[2]).replace(/\s*\/\s*$/, ''), url: `https://m.maoyan.com/asgard/celebrity/${am[1]}` });
  }

  return {
    id: String(id), name, english_name: englishName, category, show_time: showTime,
    duration_min: duration, score: score ? Number(score) : null,
    score_count: scoreCount ? Number(scoreCount.replace(/,/g, '')) : null,
    description, poster, poster_hd: poster, actors,
    source_url: `https://m.maoyan.com/asgard/movie/${id}`
  };
}

function parsePerson(html, id) {
  const text = stripTags(html);
  const title = pick(/<title>([^_<]+?)(?:_猫眼电影|_电影|<)/i, html) || pick(/<h1[^>]*>([^<]+)<\/h1>/i, html);
  const avatar = hdImage(
    pick(/<meta\s+name=["']share:wechat:message:icon["']\s+content=["']([^"']+)["']/i, html) ||
    pick(/<img[^>]+class=["'][^"']*(?:avatar|celebrity|portrait)[^"']*["'][^>]+(?:src|data-src)=["']([^"']+)["']/i, html)
  );
  const desc = pick(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i, html);
  return { id: String(id), name: title, avatar, description: desc, text_excerpt: text.slice(0, 800), source_url: `https://m.maoyan.com/asgard/celebrity/${id}` };
}

function parseAjaxExtra(html) {
  const text = stripTags(html);
  const boxOffice = {};
  const re = /([\d.]+)\s*(万|亿)?\s*(首日票房|首周票房|累计票房|总票房)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = Number(m[1]); const unit = m[2] || ''; const label = m[3];
    let wan = raw; if (unit === '亿') wan = raw * 10000;
    boxOffice[label] = { display: `${m[1]}${unit || '万'}`, value_wan: wan };
  }
  function section(label, nextLabels) {
    const idx = text.indexOf(label); if (idx < 0) return '';
    let end = text.length;
    for (const n of nextLabels) { const p = text.indexOf(n, idx + label.length); if (p >= 0 && p < end) end = p; }
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

function nearbyValue(html, pos, patterns) {
  const start = Math.max(0, pos - 1200), end = Math.min(html.length, pos + 1800);
  const win = html.slice(start, end);
  for (const re of patterns) { const v = pick(re, win); if (v) return v; }
  return '';
}

function parseVideos(html, movieId, sourceUrl) {
  const raw = String(html || '');
  const text = stripTags(raw);
  const trailerCount = Number(pick(/预告片\s*(\d+)/, text)) || 0;
  const officialCount = Number(pick(/官方视频\s*(\d+)/, text)) || 0;
  const ids = [];
  const seen = new Set();
  for (const m of raw.matchAll(/(?:videoId[=:\"']+|\"videoId\"\s*:\s*)(\d+)/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push({ id: m[1], pos: m.index || 0 }); }
  }
  // 某些页面把 id 放在 /preview?videoId=... 中
  for (const m of raw.matchAll(/preview\?videoId=(\d+)/gi)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push({ id: m[1], pos: m.index || 0 }); }
  }

  const videos = ids.slice(0, 80).map((v, index) => {
    let title = nearbyValue(raw, v.pos, [
      /(?:videoName|videoTitle|title|name)\s*["']?\s*[:=]\s*["']([^"']{3,180})["']/i,
      /<h\d[^>]*>([^<]{3,180})<\/h\d>/i,
      /<p[^>]*>([^<]{3,180})<\/p>/i
    ]);
    const windowText = stripTags(raw.slice(Math.max(0, v.pos - 700), Math.min(raw.length, v.pos + 1200)));
    const duration = pick(/\b(\d{1,2}:\d{2})\b/, windowText);
    const playCount = pick(/([\d.]+\s*(?:万|亿)?)\s*(?:次播放|播放)?/, windowText);
    const cover = hdImage(nearbyValue(raw, v.pos, [
      /(?:cover|img|image|poster|videoImg)\s*["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"']+)["']/i,
      /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i
    ]).replace(/\\\//g, '/'));
    if (!title) {
      // 尝试用附近纯文本去掉时长/播放量后作为标题
      title = windowText.replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/[\d.]+\s*(?:万|亿)?\s*(?:次播放|播放)/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    let type = 'official';
    if (trailerCount && index < trailerCount) type = 'trailer';
    else if (/预告|trailer|先导|终极预告|IMAX预告/i.test(title)) type = 'trailer';
    const href = `https://www.maoyan.com/films/${movieId}/preview?videoId=${v.id}`;
    return { video_id: v.id, title, duration, play_count: playCount, cover, type, source_page_url: href, direct_media_url: null };
  });

  return {
    movie_id: String(movieId), count: videos.length,
    trailer_count: trailerCount || videos.filter(v => v.type === 'trailer').length,
    official_count: officialCount || videos.filter(v => v.type !== 'trailer').length,
    videos, source_url: sourceUrl
  };
}

function mergeVideoResults(results, movieId) {
  const map = new Map(); let trailerCount = 0, officialCount = 0;
  for (const r of results) {
    if (!r || !Array.isArray(r.videos)) continue;
    trailerCount = Math.max(trailerCount, r.trailer_count || 0);
    officialCount = Math.max(officialCount, r.official_count || 0);
    for (const v of r.videos) {
      const old = map.get(v.video_id) || {};
      map.set(v.video_id, {
        ...old, ...v,
        title: v.title && v.title.length > (old.title || '').length ? v.title : (old.title || v.title),
        cover: old.cover || v.cover,
        duration: old.duration || v.duration,
        play_count: old.play_count || v.play_count,
        type: old.type === 'trailer' || v.type === 'trailer' ? 'trailer' : 'official'
      });
    }
  }
  const videos = [...map.values()];
  if (trailerCount) videos.forEach((v, i) => { if (i < trailerCount) v.type = 'trailer'; });
  return { movie_id: String(movieId), count: videos.length, trailer_count: trailerCount || videos.filter(v=>v.type==='trailer').length, official_count: officialCount || videos.filter(v=>v.type!=='trailer').length, videos };
}

module.exports = async function handler(req, res) {
  const started = Date.now();
  const action = String(req.query.action || 'status');
  const fetchedAt = new Date().toISOString();
  try {
    if (action === 'status') {
      return json(res, 200, { ok: true, provider: 'maoyan', status: 'ACTIVE', fetched_at: fetchedAt, capabilities: ['search','detail','people','boxoffice','videos'] });
    }

    if (action === 'search') {
      const q = String(req.query.q || '').trim();
      if (!q) return json(res, 400, { ok: false, error: 'missing q' });
      const url = `https://m.maoyan.com/apollo/ajax/search?kw=${encodeURIComponent(q)}&cityId=1&stype=-1`;
      const text = await fetchText(url);
      let data; try { data = JSON.parse(text); } catch { throw new Error('search response is not JSON'); }
      const movies = collectMovies(data).slice(0, 30);
      return json(res, 200, { ok: true, provider: 'maoyan', action, query: q, fetched_at: fetchedAt, latency_ms: Date.now() - started, count: movies.length, movies, source_url: url });
    }

    if (action === 'people') {
      const ids = String(req.query.ids || '').split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x)).slice(0, 8);
      if (!ids.length) return json(res, 400, { ok: false, error: 'missing ids' });
      const people = await Promise.all(ids.map(async id => {
        const url = `https://m.maoyan.com/asgard/celebrity/${id}`;
        try { return parsePerson(await fetchText(url, MOBILE_UA), id); }
        catch (e) { return { id, name: '', avatar: '', source_url: url, error: e.message }; }
      }));
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now()-started, people });
    }

    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return json(res, 400, { ok: false, error: 'missing/invalid id' });

    if (action === 'detail') {
      const mobileUrl = `https://m.maoyan.com/asgard/movie/${id}`;
      const ajaxUrl = `https://www.maoyan.com/ajax/films/${id}`;
      const [detailR, extraR] = await Promise.allSettled([fetchText(mobileUrl, MOBILE_UA), fetchText(ajaxUrl, DESKTOP_UA)]);
      if (detailR.status !== 'fulfilled') throw detailR.reason;
      const detail = parseDetail(detailR.value, id);
      const extra = extraR.status === 'fulfilled' ? parseAjaxExtra(extraR.value) : { box_office: {}, publisher: '', tech_param: '', behind_the_scenes: '', error: String(extraR.reason || '') };
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now() - started, movie: { ...detail, ...extra }, sources: { detail: mobileUrl, extra: ajaxUrl } });
    }

    if (action === 'videos') {
      const urls = [
        `https://qqw.maoyan.com/asgard/movie/${id}/preview`,
        `https://www.maoyan.com/films/${id}/preview`,
        `https://m.maoyan.com/asgard/movie/${id}/preview`
      ];
      const rs = await Promise.allSettled(urls.map((u,i)=>fetchText(u, i===1?DESKTOP_UA:MOBILE_UA, `https://www.maoyan.com/films/${id}`)));
      const parsed = rs.map((r,i)=>r.status==='fulfilled'?parseVideos(r.value,id,urls[i]):null).filter(Boolean);
      if (!parsed.length) throw new Error('all video sources failed');
      const merged = mergeVideoResults(parsed, id);
      return json(res, 200, { ok: true, provider: 'maoyan', action, fetched_at: fetchedAt, latency_ms: Date.now()-started, ...merged, sources: urls, source_status: rs.map((r,i)=>({url:urls[i],status:r.status,error:r.status==='rejected'?String(r.reason):''})) });
    }

    return json(res, 404, { ok: false, error: `unknown action: ${action}` });
  } catch (error) {
    return json(res, 502, { ok: false, provider: 'maoyan', action, status: 'FETCH_FAILED', fetched_at: fetchedAt, latency_ms: Date.now() - started, error: error && error.message ? error.message : String(error) });
  }
};
