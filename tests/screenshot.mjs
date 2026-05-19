import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs';
import url from 'node:url'; import puppeteer from 'puppeteer';
import { setTimeout as wait } from 'node:timers/promises';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8767;
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.py':'text/x-python','.json':'application/json','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p='/index.html';
  const f = path.join(ROOT,p);
  if (!fs.existsSync(f)){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const browser = await puppeteer.launch({headless:'new', args:['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({width:1400, height:1900});
await page.goto(`http://localhost:${PORT}/`, {waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#py-loading').hidden===true, {timeout:90000});
await page.click('#btn-start');
await wait(2500);
await page.screenshot({path: path.join(__dirname, 'snap_main.png'), fullPage:true});
await page.click('button.tab[data-tab="waterfall"]'); await wait(800);
await page.screenshot({path: path.join(__dirname, 'snap_waterfall.png'), fullPage:false});
await page.click('button.tab[data-tab="phase"]'); await wait(800);
await page.screenshot({path: path.join(__dirname, 'snap_phase.png'), fullPage:false});
console.log('OK screenshots saved');
await browser.close(); server.close();
