var rule = {
    title: 'PPnix',
    host: 'https://www.ppnix.com',
    homeUrl: '/cn/',
    url: '/cn/fyclass/fypage.html',
    searchUrl: '/cn/search/**--.html',
    searchable: 2,
    quickSearch: 1,
    filterable: 0,
    searchNoPage: 1,
    headers: {
        'User-Agent': 'PC_UA',
        'Referer': 'https://www.ppnix.com/'
    },
    timeout: 20000,
    play_parse: true,
    limit: 24,

    class_name: '电影&电视剧',
    class_url: 'movie&tv',

    // 首页：PPnix 中文首页的推荐/热门卡片
    推荐: '.lists-content&&li;h2 a&&Text;img&&src;.rate&&Text;a&&href',

    // 分类页
    一级: '.lists-content&&li;h2 a&&Text;img&&src;.countrie span&&Text;a&&href',

    // 搜索结果
    搜索: '.lists-content&&li;h2 a&&Text;img&&src;.countrie span&&Text;a&&href',

    // 详情与播放列表
    二级: {
        title: 'h1.product-title&&Text',
        img: 'img.thumb&&src',
        desc: '.product-excerpt:eq(4)&&Text;.product-excerpt:eq(2)&&Text;.product-excerpt:eq(3)&&Text;.product-excerpt:eq(0)&&Text;.product-excerpt:eq(1)&&Text',
        content: '.product-excerpt:eq(5)&&Text',
        tabs: 'js:TABS=["PPnix"]',
        lists: `js:
            try {
                var idm = html.match(/infoid=(\\d+)/);
                var mm = html.match(/m3u8=\\[(.*?)\\]/);
                var list = [];
                if (idm && mm) {
                    var infoid = idm[1];
                    var raw = mm[1].replace(/[\"']/g, '');
                    var eps = raw.split(',').map(function(x){ return x.trim(); }).filter(function(x){ return !!x; });
                    eps.forEach(function(ep, idx){
                        var label = ep;
                        if (/^\\d+$/.test(ep)) label = '第' + (idx + 1) + '集';
                        var u = HOST + '/info/m3u8/' + infoid + '/' + encodeURIComponent(ep) + '.m3u8';
                        list.push(label + '$' + u);
                    });
                }
                LISTS = [list];
            } catch (e) {
                log('PPnix lists error: ' + e.message);
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
                'User-Agent': PC_UA,
                'Referer': HOST + '/'
            })
        };
    `
};
