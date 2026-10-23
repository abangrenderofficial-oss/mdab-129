import assert from 'node:assert/strict';
import { parseTikTokPagePhoto, resolveTikTokEmbeddedPhoto } from '../src/tiktok-photo-embed.js';
import { cachedTikTokSlideshowChoice, rememberTikTokSlideshowChoice } from '../src/features/tiktok-slideshow.js';

const id='7695372802735492360',canonical='https://www.tiktok.com/@letersurf/photo/'+id;
const example={id,desc:'Photo test',imagePost:{images:[
 { imageURL:{urlList:['https://cdn.tiktok.test/image-1.jpg']},imageWidth:1080,imageHeight:1920 },
 { imageURL:{urlList:['https://cdn.tiktok.test/image-2.jpg']},imageWidth:1080,imageHeight:1920 },
]},music:{title:'Real original song',authorName:'Real musician',duration:11,playUrl:'https://cdn.tiktok.test/original.m4a'}};
const html=(item=example)=>'<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'+JSON.stringify({__DEFAULT_SCOPE__:{'webapp.video-detail':{statusCode:0,itemInfo:{itemStruct:item}}}})+'</script></html>';
const pages=[];
const fetchImpl=async(url)=>{
 const u=String(url);pages.push(u);
 if(u.includes('/embed/v2/'))throw new Error('Embed 429 should not be called');
 if(u.includes('vt.tiktok.com'))return {url:canonical,body:{cancel:async()=>{}}};
 if(u.includes('/video/'+id))return {ok:true,headers:new Headers({'content-type':'text/html'}),text:async()=>html()};
 throw new Error('Unexpected call '+u);
};
const resolved=await resolveTikTokEmbeddedPhoto(canonical,{fetchImpl});
assert.equal(resolved.source,'tiktok-original-video-page');
assert.equal(resolved.images.length,2);
assert.equal(resolved.images[0].url,'https://cdn.tiktok.test/image-1.jpg');
assert.equal(resolved.audio.url,'https://cdn.tiktok.test/original.m4a');
assert.equal(resolved.audio.title,'Real original song');
assert.equal(resolved.canonicalUrl,canonical);
assert.equal(pages.length,1);
assert.ok(pages[0].includes('/video/'+id));
assert.equal(parseTikTokPagePhoto(html({...example,id:'1234567890123456789'}),id),null);
assert.equal(parseTikTokPagePhoto(html({...example,music:{}}),id),null);
assert.equal(parseTikTokPagePhoto(html({...example,imagePost:{images:[]}}),id),null);
assert.equal(parseTikTokPagePhoto(html({...example,imagePost:{images:[{imageURL:{urlList:['javascript:alert(1)']}}]}}),id),null);
const shortPages=[];
const short=await resolveTikTokEmbeddedPhoto('https://vt.tiktok.com/ZSg596PLD/',{fetchImpl:async(url)=>{
 shortPages.push(String(url));
 return fetchImpl(url);
}});
assert.equal(short.images.length,2);
assert.ok(shortPages[0].includes('vt.tiktok.com'));
const sentId=993;
assert.equal(rememberTikTokSlideshowChoice(123,sentId,456,canonical,resolved),true);
const cached=cachedTikTokSlideshowChoice(123,sentId,456);
assert.equal(cached.images.length,2);
assert.equal(cached.audio.url,resolved.audio.url);
assert.equal(cachedTikTokSlideshowChoice(123,sentId,777),null);
assert.equal(cachedTikTokSlideshowChoice(999,sentId,456),null);
assert.equal(cachedTikTokSlideshowChoice(123,991,456),null);
console.log('MEDIA_X_TIKTOK_PHOTO_PAGE_CACHE_TEST_OK - 2 original assets, sound, privacy, rejection and single source fetch');
