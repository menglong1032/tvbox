function ddysDecode(s) {
    return String(s || '')
        .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(Number(n)); })
        .replace(/&#x([0-9a-f]+);/gi, function(_, n){ return String.fromCharCode(parseInt(n,16)); })
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function ddysStrip(s) {
    return ddysDecode(String(s || '').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}

function ddysAttr(s, name) {
    var r = new RegExp('\\b' + name + '\\s*=\\s*(["\\\'])([\\s\\S]*?)\\1','i');
    var m = String(s || '').match(r);
    return m ? ddysDecode(m[2]).trim() : '';
}

function ddysAbs(u) {
    u = ddysDecode(String(u || '').trim());
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    if (u.charAt(0) !== '/') u = '/' + u;
    return HOST + u;
}

function ddysCards(src) {
    var out = [];
    var seen = {};
    var re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
    var m;
    while ((m = re.exec(String(src || ''))) !== null) {
        var attrs = m[1] || '';
        var body = m[2] || '';
        var cls = ddysAttr(attrs,'class');
        if (!/(^|\s)(post-box|post)(\s|$)/.test(cls)) continue;

        var tm = body.match(/<h2\b[^>]*class=(["'])[^"']*\bpost-(?:box-)?title\b[^"']*\1[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/i);
        if (!tm) continue;

        var title = ddysStrip(tm[3]);
        var url = ddysAbs(ddysAttr(attrs,'data-href') || ddysAttr(tm[2],'href'));
        if (!title || !url || seen[url]) continue;

        var sm = body.match(/background-image\s*:\s*url\(\s*(["']?)([^"')]+)\1\s*\)/i);
        var img = sm ? ddysAbs(sm[2]) : '';
        var dm = body.match(/<div\b[^>]*class=(["'])[^"']*\bpost-box-text\b[^"']*\1[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i);
        var desc = dm ? ddysStrip(dm[2]) : '';
        var pm = body.match(/<[^>]*class=(["'])[^"']*\bpublished\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i);
        if (!desc && pm) desc = ddysStrip(pm[2]);

        seen[url] = true;
        out.push({title:title,img:img,desc:desc,url:url});
    }
    return out;
}

function ddysPlaylist(src) {
    var m = String(src || '').match(/<script[^>]*class=["'][^"']*\bddys-playlist-data\b[^"']*["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m || !m[1]) return null;
    try {
        var p = JSON.parse(m[1].trim());
        return p && Array.isArray(p.seasons) ? p : null;
    } catch(e) {
        log('DDYS playlist parse failed: ' + e.message);
        return null;
    }
}

function ddysTrackUrl(t, preferV2) {
    var src = t && t.src ? String(t.src).replace(/\\/g,'/').trim() : '';
    var server = t && t.server ? String(t.server).trim().toLowerCase() : '';
    if (!src) return '';
    var u = src;
    if (!/^https?:\/\//i.test(src)) {
        if (!/^[a-z0-9-]+$/.test(server)) return '';
        if (src.charAt(0) !== '/') src = '/' + src;
        u = 'https://' + server + '.ddys.app' + src;
    }
    if (preferV2 && /^https:\/\/v3\.ddys\.app/i.test(u)) {
        u = u.replace(/^https:\/\/v3\.ddys\.app/i,'https://v2.ddys.app');
    }
    return u;
}

var rule = {
    title: 'DDYS',
    host: 'https://ddys.app',
    homeUrl: '/page/1/',
    url: '/fyclass/page/fypage/',
    searchUrl: '/?s=**&post_type=post',
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    searchNoPage: 1,
    headers: {
        'User-Agent': 'MOBILE_UA'
    },
    timeout: 30000,
    play_parse: true,
    limit: 20,

    // 使用当前 DDYS 公开适配生态维护的有效访问会话；
    // 这里只负责把可用会话传给请求，不在 TVBox 内破解验证码。
    预处理: `
        try {
            let txt = request('https://raw.githubusercontent.com/qoli/syncnextPlugin/main/plugin_ddys/cookie.json');
            let pool = JSON.parse(txt || '{}');
            let now = Date.now();
            let arr = Array.isArray(pool.cookies) ? pool.cookies.filter(function(it){
                return it && it.cookie && Date.parse(it.validUntil) > now;
            }) : [];
            if (arr.length > 0) {
                arr.sort(function(a,b){ return Date.parse(b.validUntil) - Date.parse(a.validUntil); });
                let ck = arr[0].cookie;
                rule.headers.Cookie = ck;
                rule_fetch_params.headers.Cookie = ck;
                log('DDYS: active access session loaded');
            }
        } catch (e) {
            log('DDYS: access session unavailable: ' + e.message);
        }
    `,

    class_name: '电影&电视剧&动漫&综艺',
    class_url: 'category/movie&category/drama&category/anime&category/variety',

    推荐: `js:
        let a = ddysCards(html);
        VODS = a.map(function(it){
            return {vod_id:it.url,vod_name:it.title,vod_pic:it.img,vod_remarks:it.desc};
        });
    `,

    一级: `js:
        setResult(ddysCards(html));
    `,

    搜索: `js:
        setResult(ddysCards(html));
    `,

    二级: {
        title: '.post-title&&Text;.cat-links&&Text',
        img: '.doulist-item&&img&&data-cfsrc',
        desc: '.published&&Text',
        content: '.abstract&&Text',
        tabs: `js:
            let p = ddysPlaylist(html);
            let tabs = [];
            if (p && p.seasons) {
                p.seasons.forEach(function(s, si){
                    let tracks = Array.isArray(s.tracks) ? s.tracks : [];
                    let sn = Number(s && s.season) || (si + 1);
                    let base = p.seasons.length > 1 ? ('第' + sn + '季') : 'DDYS';
                    let hasV3 = tracks.some(function(t){
                        let u = ddysTrackUrl(t, false);
                        return /^https:\/\/v3\.ddys\.app/i.test(u);
                    });
                    if (hasV3) {
                        tabs.push(base + '·线路1');
                        tabs.push(base + '·线路2');
                    } else {
                        tabs.push(base);
                    }
                });
            }
            TABS = tabs.length ? tabs : ['DDYS'];
        `,
        lists: `js:
            let p = ddysPlaylist(html);
            let all = [];
            if (p && p.seasons) {
                p.seasons.forEach(function(s){
                    let tracks = Array.isArray(s.tracks) ? s.tracks : [];
                    let hasV3 = tracks.some(function(t){
                        return /^https:\/\/v3\.ddys\.app/i.test(ddysTrackUrl(t,false));
                    });
                    function build(preferV2){
                        return tracks.map(function(t, idx){
                            let ep = Number(t && t.episode);
                            let name = t && t.title ? String(t.title).trim() : ('第' + (ep > 0 ? ep : (idx + 1)) + '集');
                            let u = ddysTrackUrl(t, preferV2);
                            return u ? (name + '$' + u) : '';
                        }).filter(function(x){ return !!x; });
                    }
                    if (hasV3) {
                        all.push(build(true));
                        all.push(build(false));
                    } else {
                        all.push(build(false));
                    }
                });
            }
            LISTS = all.length ? all : [[]];
        `
    },

    lazy: `js:
        let u = String(input || '').trim();
        input = {
            jx: 0,
            parse: 0,
            url: u,
            header: JSON.stringify({
                'User-Agent': MOBILE_UA,
                'Referer': HOST + '/'
            })
        };
    `
};
