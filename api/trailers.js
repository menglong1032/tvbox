const MOBILE_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function json(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=600');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.end(JSON.stringify(body));
}

function image(u=''){
  u=String(u||'').trim().replace(/\\\//g,'/').replace(/&amp;/gi,'&');
  if(u.startsWith('//'))u='https:'+u;
  if(u.startsWith('http://'))u='https://'+u.slice(7);
  return u;
}

function duration(sec){
  const n=Number(sec);
  if(!Number.isFinite(n))return'';
  return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
}

function rank(v){
  const t=String(v.title||'');
  if(/首支|首曝/.test(t))return 0;
  if(/正式|终极|定档/.test(t))return 1;
  if(/第二支/.test(t))return 2;
  if(/IMAX/.test(t))return 3;
  if(/预告/.test(t)&&!/番外|花絮|彩蛋|片段|幕后/.test(t))return 4;
  if(/番外|花絮|彩蛋|片段|幕后/.test(t))return 9;
  return 6;
}

async function getJson(url,referer){
  const r=await fetch(url,{
    headers:{
      'User-Agent':MOBILE_UA,
      'Referer':referer,
      'Accept':'application/json,text/plain,*/*',
      'Accept-Language':'zh-CN,zh;q=0.9',
      'X-Requested-With':'XMLHttpRequest'
    },
    redirect:'follow'
  });
  const raw=await r.text();
  if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);
  try{return JSON.parse(raw)}catch{throw new Error('Maoyan API returned non-JSON')}
}

module.exports=async function(req,res){
  const started=Date.now();
  const id=String(req.query.id||'').trim();
  if(!/^\d+$/.test(id))return json(res,400,{ok:false,error:'missing/invalid id'});

  const referer=`https://m.maoyan.com/asgard/movie/${id}/preview`;
  const listUrl=`https://m.maoyan.com/asgard/api/sns/common/video/commend/module/videos.json?movieId=${id}&moduleId=1&offset=0&limit=10&timeStamp=${Date.now()}`;

  try{
    const list=await getJson(listUrl,referer);
    const feeds=list?.data?.feeds||[];
    if(!list?.success||!Array.isArray(feeds))throw new Error('Maoyan trailer list unavailable');

    const videos=await Promise.all(feeds.map(async feed=>{
      const videoId=String(feed?.video?.id||feed?.id||'');
      const feedType=Number(feed?.video?.feedType||feed?.feedType||feed?.type||3);
      if(!/^\d+$/.test(videoId))return null;
      const playUrl=`https://m.maoyan.com/asgard/api/mmdb/movie/video/feed/${videoId}.json?requestSource=1&feedType=${feedType}&channelId=4`;
      try{
        const play=await getJson(playUrl,referer);
        const p=play?.data||{};
        return{
          video_id:videoId,
          title:String(feed?.title||feed?.shareInfo?.title||p?.tl||p?.shareTitle||'官方预告').trim(),
          type:'trailer',
          type_desc:'预告片',
          direct_media_url:String(p?.url||'').replace(/\\\//g,'/'),
          cover:image(p?.img||feed?.video?.imgUrl||feed?.images?.[0]?.url||feed?.shareInfo?.img||''),
          duration_seconds:Number(p?.tm)||Number(feed?.video?.dur)||null,
          duration:duration(Number(p?.tm)||Number(feed?.video?.dur)),
          width:Number(p?.width)||Number(feed?.video?.width)||null,
          height:Number(p?.height)||Number(feed?.video?.height)||null,
          play_count:Number(p?.watched)||Number(feed?.video?.viewCount)||0,
          feed_type:feedType,
          source_page_url:`https://m.maoyan.com/asgard/movie/${id}/preview?videoId=${videoId}&feedType=${feedType}`,
          list_source:listUrl,
          play_source:playUrl
        };
      }catch(error){
        return{
          video_id:videoId,
          title:String(feed?.title||feed?.shareInfo?.title||'官方预告').trim(),
          type:'trailer',
          type_desc:'预告片',
          direct_media_url:'',
          cover:image(feed?.video?.imgUrl||feed?.images?.[0]?.url||feed?.shareInfo?.img||''),
          feed_type:feedType,
          error:error.message||String(error)
        };
      }
    }));

    const ordered=videos.filter(Boolean).sort((a,b)=>rank(a)-rank(b));
    const playable=ordered.filter(v=>v.direct_media_url);
    return json(res,200,{
      ok:true,
      provider:'maoyan',
      movie_id:id,
      count:ordered.length,
      playable_count:playable.length,
      trailer_count:Number(list?.data?.paging?.total)||ordered.length,
      videos:ordered,
      latency_ms:Date.now()-started,
      source_url:listUrl
    });
  }catch(error){
    return json(res,502,{ok:false,provider:'maoyan',movie_id:id,error:error.message||String(error),latency_ms:Date.now()-started});
  }
};
