// Диагностика: для каждой из 9 мишеней принудительно задаём её как загаданную
// и проверяем, что Python-алгоритм возвращает её номер.
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.py':'text/x-python','.json':'application/json'};
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
page.on('console', m=>{ if(m.type()==='error') console.log('[err]', m.text()); });
await page.goto(`http://localhost:${PORT}/`, {waitUntil:'domcontentloaded'});
await page.waitForFunction(() => document.querySelector('#py-loading').hidden === true, {timeout:90_000});

for (let n = 1; n <= 9; n++){
  await page.evaluate(N => {
    window.simulator.resetRound();
    // принудительно «загадать» мишень N
    const t = window.simulator.targets.find(x => x.n === N);
    window.simulator.judgeTargetN = N;
    window.simulator.judgeCode    = t.code;
    window.simulator.round = {active:true,startTime:performance.now(),stopTime:0,
      penaltyMs:0,ammo:3,declaredTarget:null,declaredAt:null,hits:new Set(),winner:false};
    document.querySelector('#py-output').textContent = '';
  }, n);

  await page.evaluate(() => {
    document.querySelector('#editor').value = `
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32
from radiofest_helpers import find_packet, est_phase, target_number, judge_code
from js import simulator

target_code = judge_code()
def open_sdr(idx):
    s = SoapySDR.Device({"driver":"lime","index":idx})
    s.setSampleRate(SOAPY_SDR_RX, 0, 200e3); s.setFrequency(SOAPY_SDR_RX,0,2.6e9)
    return s
sx = open_sdr(0); sy = open_sdr(1)
stx = sx.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0,1]); sx.activateStream(stx)
sty = sy.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0,1]); sy.activateStream(sty)
expected_n = int(simulator.judgeTargetN)
N = 24000
for attempt in range(20):
    bx0=np.zeros(N,np.complex64); bx1=np.zeros(N,np.complex64)
    by0=np.zeros(N,np.complex64); by1=np.zeros(N,np.complex64)
    sx.readStream(stx,[bx0,bx1],N); sy.readStream(sty,[by0,by1],N)
    win = find_packet(bx0, target_code)
    if win is not None:
        dphi_x = est_phase(bx0, bx1, window=win)
        dphi_y = est_phase(by0, by1, window=win)
        n = target_number(dphi_x, dphi_y)
        print("RESULT", expected_n, n, round(np.degrees(dphi_x),1), round(np.degrees(dphi_y),1))
        break
else:
    print("RESULT", expected_n, -1, 0, 0)
`;
  });
  await page.click('#btn-run');
  await page.waitForFunction(
    () => /RESULT/.test(document.querySelector('#py-output').textContent),
    {timeout:60_000}
  );
  const out = await page.$eval('#py-output', e => e.textContent);
  const m = out.match(/RESULT (\d+) (-?\d+) (-?[\d.]+) (-?[\d.]+)/);
  console.log(`N=${n}  got=${m?m[2]:'?'}  Δφx=${m?m[3]:'?'}°  Δφy=${m?m[4]:'?'}°  ${m && parseInt(m[2])===n ? 'OK' : 'FAIL'}`);
}

await browser.close();
server.close();
