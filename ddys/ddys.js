var rule = {
    title: 'DDYS',
    host: 'https://ddys.app',
    url: '/page/fypage/',
    searchUrl: '/?s=**&post_type=post',
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    headers: {
        'User-Agent': 'MOBILE_UA'
    },
    play_parse: true,
    limit: 6,

    // DDYS 当前有访问保护。优先读取公开维护的有效访问 Cookie；
    // 如果 Cookie 池暂时不可用，规则仍会继续尝试普通访问。
    预处理: `
        try {
            let txt = request('https://raw.githubusercontent.com/qoli/syncnextPlugin/main/plugin_ddys/cookie.json');
            let pool = JSON.parse(txt || '{}');
            let now = Date.now();
            let arr = Array.isArray(pool.cookies) ? pool.cookies.filter(it => it && it.cookie && Date.parse(it.validUntil) > now) : [];
            if (arr.length > 0) {
                arr.sort((a,b) => Date.parse(b.validUntil) - Date.parse(a.validUntil));
                rule_fetch_params.headers.Cookie = arr[0].cookie;
                log('DDYS: loaded active access cookie');
            }
        } catch (e) {
            log('DDYS: cookie preload skipped: ' + e.message);
        }
    `,

    // 首页与搜索结果
    推荐: '*',
    double: true,
    一级: '.post-box-list&&article;.post-title&&Text;.post-box-image&&style;.post-box-text&&Text;a&&href',
    搜索: '#main&&article;.post-title&&Text;.post-box-image&&style;.published&&Text;a&&href',

    // 分类尽量从站点菜单自动读取；分类失败不影响搜索和详情。
    class_parse: '#primary-menu li.menu-item;a&&Text;a&&href;\\.app/(.*)',
    cate_exclude: '站长|其他|关于|类型',

    二级: {
        title: '.post-title&&Text;.cat-links&&Text',
        img: '.post img&&src',
        desc: '.published&&Text',
        content: '.abstract&&Text',
        tabs: `js:
            try {
                let m = html.match(/<script[^>]*class=["'][^"']*\\bddys-playlist-data\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/script>/i);
                let p = m && m[1] ? JSON.parse(m[1].trim()) : null;
                if (!p || !Array.isArray(p.seasons)) {
                    TABS = ['DDYS'];
                } else {
                    TABS = p.seasons.map(function(s, i) {
                        let sn = Number(s && s.season);
                        if (p.seasons.length === 1) return 'DDYS';
                        return '第' + (sn > 0 ? sn : (i + 1)) + '季';
                    });
                }
            } catch (e) {
                log('DDYS tabs error: ' + e.message);
                TABS = ['DDYS'];
            }
        `,
        lists: `js:
            try {
                let m = html.match(/<script[^>]*class=["'][^"']*\\bddys-playlist-data\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/script>/i);
                let p = m && m[1] ? JSON.parse(m[1].trim()) : null;
                if (!p || !Array.isArray(p.seasons)) {
                    LISTS = [[]];
                } else {
                    LISTS = p.seasons.map(function(s) {
                        let tracks = Array.isArray(s.tracks) ? s.tracks : [];
                        return tracks.map(function(t, idx) {
                            let src = t && t.src ? String(t.src).replace(/\\\\/g, '/').trim() : '';
                            let server = t && t.server ? String(t.server).trim().toLowerCase() : '';
                            let url = src;
                            if (src && !/^https?:\\/\\//i.test(src) && /^[a-z0-9-]+$/.test(server)) {
                                if (src.charAt(0) !== '/') src = '/' + src;
                                url = 'https://' + server + '.ddys.app' + src;
                            }
                            let ep = Number(t && t.episode);
                            let name = t && t.title ? String(t.title).trim() : ('第' + (ep > 0 ? ep : (idx + 1)) + '集');
                            return name + '$' + url;
                        }).filter(function(x) { return /\\$https?:\\/\\//.test(x); });
                    });
                }
            } catch (e) {
                log('DDYS lists error: ' + e.message);
                LISTS = [[]];
            }
        `
    },

    lazy: `js:
        let u = input;
        if (/^https:\\/\\/v3\\.ddys\\.app/i.test(u)) {
            u = u.replace(/^https:\\/\\/v3\\.ddys\\.app/i, 'https://v2.ddys.app');
        }
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
