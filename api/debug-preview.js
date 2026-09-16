const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
function around(s,needle,n=260){const out=[];let i=0;while((i=s.indexOf(needle,i))>=0&&out.length<20){out.push(s.slice(Math.max(0,i-n),Math.min(s.length,i+n)));i+=needle.length}return out}
module.exports=async function(req,res){
 const id=String(req.query.id||'1294273');
 const url=`https://m.maoyan.com/asgard/movie/${id}/preview`;
 try{
  const r=await fetch(url,{headers:{'User-Agent':UA,'Referer':`https://m.maoyan.com/asgard/movie/${id}`,'Accept':'text/html,application/xhtml+xml,*/*'}});
  const s=await r.text();
  const mp4=(s.match(/https?:\\?\/\\?\/[^\"'\\s<>]+\.mp4[^\"'\\s<>]*/gi)||[]).slice(0,30);
  const ids=[...s.matchAll(/videoId["'\\:=\s]+(\d+)/gi)].map(x=>x[1]).slice(0,50);
  res.setHeader('content-type','application/json; charset=utf-8');
  res.end(JSON.stringify({status:r.status,length:s.length,mp4_count:mp4.length,mp4,video_ids:[...new Set(ids)],videoTypes:around(s,'videoTypes',350),feeds:around(s,'videoList',900),preview:around(s,'预告',500)}));
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}))}
};
