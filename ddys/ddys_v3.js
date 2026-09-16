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
    play_parse: true,
    limit: 20,

    class_name: '最近更新&电影&电视剧&动漫&综艺',
    class_url: 'page/1&category/movie&category/drama&category/anime&category/variety',

    推荐: '.post-box-list&&article;a:eq(-1)&&Text;.post-box-image&&style;a:eq(0)&&Text;a:eq(-1)&&href',
    一级: '.post-box-list&&article;a:eq(-1)&&Text;.post-box-image&&style;a:eq(0)&&Text;a:eq(-1)&&href',
    搜索: '#main&&article;.post-title&&Text;.post-box-image&&style;.published&&Text;a&&href',

    二级: {
        title: '.post-title&&Text;.cat-links&&Text',
        img: '.doulist-item&&img&&data-cfsrc',
        desc: '.published&&Text',
        content: '.abstract&&Text',
        tabs: `js:
            try {
                let raw = pdfh(html, '.ddys-playlist-data&&Html');
                let p = JSON.parse(raw || '{}');
                let tabs = [];
                if (Array.isArray(p.seasons)) {
                    p.seasons.forEach(function(s, i) {
                        let sn = Number(s && s.season) || (i + 1);
                        let tracks = Array.isArray(s && s.tracks) ? s.tracks : [];
                        let hasV3 = false;
                        tracks.forEach(function(t) {
                            let src = t && t.src ? String(t.src).replace(/\\/g, '/') : '';
                            let server = t && t.server ? String(t.server).toLowerCase() : '';
                            let u = /^https?:\/\//i.test(src) ? src : ('https://' + server + '.ddys.app' + (src.charAt(0) === '/' ? src : '/' + src));
                            if (/^https:\/\/v3\.ddys\.app/i.test(u)) hasV3 = true;
                        });
                        let base = p.seasons.length > 1 ? ('第' + sn + '季') : 'DDYS';
                        if (hasV3) {
                            tabs.push(base + '·线路1');
                            tabs.push(base + '·线路2');
                        } else {
                            tabs.push(base);
                        }
                    });
                }
                TABS = tabs.length ? tabs : ['DDYS'];
            } catch (e) {
                TABS = ['DDYS'];
            }
        `,
        lists: `js:
            try {
                let raw = pdfh(html, '.ddys-playlist-data&&Html');
                let p = JSON.parse(raw || '{}');
                let out = [];
                if (Array.isArray(p.seasons)) {
                    p.seasons.forEach(function(s) {
                        let tracks = Array.isArray(s && s.tracks) ? s.tracks : [];
                        let normal = [];
                        let backup = [];
                        let hasV3 = false;
                        tracks.forEach(function(t, idx) {
                            let src = t && t.src ? String(t.src).replace(/\\/g, '/').trim() : '';
                            let server = t && t.server ? String(t.server).trim().toLowerCase() : '';
                            if (!src) return;
                            let u = src;
                            if (!/^https?:\/\//i.test(src)) {
                                if (!server) return;
                                if (src.charAt(0) !== '/') src = '/' + src;
                                u = 'https://' + server + '.ddys.app' + src;
                            }
                            let ep = Number(t && t.episode);
                            let name = t && t.title ? String(t.title).trim() : ('第' + (ep > 0 ? ep : (idx + 1)) + '集');
                            normal.push(name + '$' + u);
                            if (/^https:\/\/v3\.ddys\.app/i.test(u)) {
                                hasV3 = true;
                                backup.push(name + '$' + u.replace(/^https:\/\/v3\.ddys\.app/i, 'https://v2.ddys.app'));
                            } else {
                                backup.push(name + '$' + u);
                            }
                        });
                        if (hasV3) {
                            out.push(backup);
                            out.push(normal);
                        } else {
                            out.push(normal);
                        }
                    });
                }
                LISTS = out.length ? out : [[]];
            } catch (e) {
                LISTS = [[]];
            }
        `
    },

    lazy: `js:
        input = {
            jx: 0,
            parse: 0,
            url: input,
            header: JSON.stringify({
                'User-Agent': MOBILE_UA,
                'Referer': HOST + '/'
            })
        };
    `
};
