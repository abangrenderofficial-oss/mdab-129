import chromiumPack from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

const rawUrl = String(process.env.INSTAGRAM_STORY_SMOKE_URL || '').trim();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function canonicalStoryUrl(value) {
  const input = new URL(value);
  const match = input.pathname.match(/^\/stories\/([^/?#]+)\/(\d+)/i);
  if (!match?.[1] || !match?.[2]) throw new Error('instagram-story-url-invalid');
  return `https://www.instagram.com/stories/${match[1]}/${match[2]}/`;
}
function safeUrl(value) {
  try { const u = new URL(value); return `${u.origin}${u.pathname}`; } catch { return String(value).slice(0,180); }
}

async function main() {
  if (!/instagram\.com\/stories\/[^/]+\/\d+/i.test(rawUrl)) return console.log('INSTAGRAM_STORY_NETWORK_PROBE_SKIPPED');
  const target = canonicalStoryUrl(rawUrl);
  const executablePath = await chromiumPack.executablePath();
  const browser = await playwrightChromium.launch({ args: chromiumPack.args, executablePath, headless: true, timeout: 12000 });
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: {width:1280,height:900}, locale:'en-US' });
    const page = await context.newPage();
    const traces = [];
    page.on('request', (req) => {
      const method = req.method();
      const value = req.url();
      if (method !== 'GET' || /api|convert|download|ajax|result|story|graphql|instagram/i.test(value)) {
        traces.push({event:'request',method,url:safeUrl(value)});
      }
    });
    page.on('response', (res) => {
      const req = res.request();
      const value = res.url();
      if (req.method() !== 'GET' || /api|convert|download|ajax|result|story|graphql|instagram/i.test(value)) {
        traces.push({event:'response',method:req.method(),status:res.status(),url:safeUrl(value)});
      }
    });
    await page.goto('https://sssinstagram.com/story-saver', {waitUntil:'domcontentloaded',timeout:12000});
    const details = await page.evaluate(() => ({
      forms:[...document.forms].map((f)=>({action:f.action,method:f.method,id:f.id,className:f.className})).slice(0,8),
      inputs:[...document.querySelectorAll('input')].map((el)=>({type:el.type,name:el.name,id:el.id,placeholder:el.placeholder,className:el.className})).slice(0,12),
      buttons:[...document.querySelectorAll('button')].map((el)=>({type:el.type,id:el.id,text:(el.innerText||'').trim().slice(0,80),className:el.className})).slice(0,12),
    }));
    console.log('INSTAGRAM_STORY_SSS_DOM', JSON.stringify(details));
    const input = page.locator('input[type="text"], input[name="url"], input#main_page_text, input[placeholder*="Paste" i]').first();
    await input.waitFor({timeout:8000});
    await input.fill(target);
    const button = page.locator('button[type="submit"], button:has-text("Download")').first();
    await button.click({timeout:8000});
    await page.waitForTimeout(12000);
    const bodyText = await page.locator('body').innerText().catch(()=> '');
    console.log('INSTAGRAM_STORY_SSS_NETWORK', JSON.stringify(traces.slice(-80)));
    console.log('INSTAGRAM_STORY_SSS_AFTER_CLICK', JSON.stringify({url:page.url(),body:bodyText.slice(0,1200).replace(/\s+/g,' ')}));
    await context.close().catch(()=>{});
  } finally { await browser.close().catch(()=>{}); }
}
main().catch((error)=>{console.error('INSTAGRAM_STORY_NETWORK_PROBE_FAILED',error?.stack||error?.message||error);process.exit(1);});
