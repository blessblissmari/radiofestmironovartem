// E2E-тесты «Радиофест песочница».
// Запускают реальный headless-браузер через Puppeteer:
//  · поднимают локальный http.server статикой;
//  · загружают index.html;
//  · кликают «Старт раунда», ждут пока Pyodide подгрузится,
//    запускают пример «full» из Python REPL и проверяют, что
//    вычисленный номер мишени совпадает с загаданным судьёй.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import puppeteer from 'puppeteer';
import { strict as assert } from 'node:assert';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;

// --- мини-сервер статики ---
const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.py':'text/x-python', '.png':'image/png',
  '.svg':'image/svg+xml', '.pdf':'application/pdf', '.docx':'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

async function main(){
  await new Promise(r => server.listen(PORT, r));
  console.log(`[srv] listening :${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.on('console', m => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console.log(`[browser:${t}]`, m.text());
  });
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  let failed = 0;
  async function step(name, fn){
    process.stdout.write(`▸ ${name} ... `);
    try { await fn(); console.log('OK'); }
    catch (e){ failed++; console.log('FAIL'); console.error('  ', e.message); }
  }

  await page.goto(`http://localhost:${PORT}/`, {waitUntil:'domcontentloaded'});

  await step('страница загружается, заголовок про Радиофест', async () => {
    const t = await page.title();
    assert.match(t, /Радиофест/);
  });

  await step('симулятор инициализирован, 9 мишеней', async () => {
    const n = await page.evaluate(() => window.simulator.targets.length);
    assert.equal(n, 9);
  });

  await step('канвас сцены реально что-то рисует', async () => {
    await wait(300);
    const ok = await page.evaluate(() => {
      const cv = document.querySelector('#scene');
      const ctx = cv.getContext('2d');
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let nz = 0;
      for (let i = 0; i < data.length; i += 4*200){
        if (data[i] + data[i+1] + data[i+2] > 30) nz++;
      }
      return nz;
    });
    assert.ok(ok > 50, `сцена пустая, не пикселей: ${ok}`);
  });

  await step('канвас спектра рисует > 0 ненулевых пикселей', async () => {
    await wait(300);
    const ok = await page.evaluate(() => {
      const cv = document.querySelector('#spectrum');
      const ctx = cv.getContext('2d');
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let nz = 0;
      for (let i = 0; i < data.length; i += 4){
        if (data[i+1] > 60) nz++;     // зелёный канал
      }
      return nz;
    });
    assert.ok(ok > 50, 'спектр не рисуется');
  });

  await step('старт раунда выдаёт код вида ~XXXXXXX', async () => {
    await page.click('#btn-start');
    await wait(150);
    const code = await page.$eval('#judge-code', el => el.textContent);
    assert.match(code, /^~.{7}$/, `получили код "${code}"`);
  });

  await step('заявка неверного номера → штраф +60 с', async () => {
    const judgeN = await page.evaluate(() => window.simulator.judgeTargetN);
    const wrong  = (judgeN % 9) + 1;
    await page.evaluate(n => { document.querySelector('#declare-input').value = n; }, wrong);
    await page.click('#btn-declare');
    await wait(50);
    const pen = await page.evaluate(() => window.simulator.round.penaltyMs);
    assert.equal(pen, 60_000);
  });

  await step('сброс раунда', async () => {
    await page.click('#btn-reset');
    await wait(80);
    const judge = await page.$eval('#judge-code', el => el.textContent);
    assert.equal(judge, '—');
  });

  await step('live-демодулятор за 6 с ловит хотя бы один ~XXXXXXX', async () => {
    // Дать движку прогреться: первые кадры могут попасть в guard-интервал
    let seen = '?';
    for (let i = 0; i < 240; i++){
      await wait(25);
      const v = await page.$eval('#decoded-code', e => e.textContent);
      if (/^~.{7}$/.test(v)){ seen = v; break; }
    }
    assert.match(seen, /^~.{7}$/, `live-decoder вернул "${seen}"`);
  });

  await step('Pyodide подгружается за разумное время и можно выполнить numpy', async () => {
    // ждём пока скроется py-loading
    await page.waitForFunction(
      () => document.querySelector('#py-loading').hidden === true,
      { timeout: 90_000 }
    );
    await page.evaluate(() => {
      document.querySelector('#editor').value = 'import numpy as np\nprint("np_ok", np.array([1,2,3]).sum())';
    });
    await page.click('#btn-clear');
    await page.click('#btn-run');
    await page.waitForFunction(
      () => document.querySelector('#py-output').textContent.includes('np_ok 6'),
      { timeout: 30_000 }
    );
  });

  await step('SoapySDR-мок: device init, readStream возвращает CF32', async () => {
    await page.evaluate(() => {
      document.querySelector('#editor').value = `
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32
sdr = SoapySDR.Device({"driver":"lime","index":0})
sdr.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
sdr.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)
st  = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0,1])
sdr.activateStream(st)
b0 = np.zeros(2048, np.complex64); b1 = np.zeros(2048, np.complex64)
sdr.readStream(st, [b0, b1], 2048)
sdr.deactivateStream(st); sdr.closeStream(st)
print("dtype", b0.dtype, "absmax", float(np.abs(b0).max()))`;
    });
    await page.click('#btn-clear');
    await page.click('#btn-run');
    await page.waitForFunction(
      () => /dtype complex64 absmax/.test(document.querySelector('#py-output').textContent),
      { timeout: 30_000 }
    );
    const out = await page.$eval('#py-output', e => e.textContent);
    const m = out.match(/absmax\s+([\d.eE+\-]+)/);
    assert.ok(m && parseFloat(m[1]) > 0, `пустой буфер: ${out}`);
  });

  await step('Полный пример: программа определяет правильный номер мишени', async () => {
    await page.click('#btn-reset');
    await page.click('#btn-start');
    await wait(150);

    // подгружаем пример "full"
    await page.evaluate(() => {
      const ex = document.querySelector('#py-examples');
      ex.value = 'full';
      ex.dispatchEvent(new Event('change'));
    });
    await page.click('#btn-clear');
    await page.click('#btn-run');
    // ожидаем строку "→ объявите судье №X"
    await page.waitForFunction(
      () => /→ объявите судье №\d/.test(document.querySelector('#py-output').textContent)
            || /не пойман/.test(document.querySelector('#py-output').textContent),
      { timeout: 60_000 }
    );
    const out = await page.$eval('#py-output', e => e.textContent);
    const m = out.match(/→ объявите судье №(\d)/);
    assert.ok(m, `не нашёл вывод от примера 05:\n${out}`);
    const guessed = parseInt(m[1], 10);
    const expected = await page.evaluate(() => window.simulator.judgeTargetN);
    console.log(`\n   guessed=${guessed}  expected=${expected}`);
    assert.equal(guessed, expected,
      `алгоритм определил неверный номер: ${guessed}, надо ${expected}`);
  });

  await step('Огонь по правильной мишени с двух-трёх попыток', async () => {
    const expected = await page.evaluate(() => window.simulator.judgeTargetN);
    // Объявить судье
    await page.evaluate(n => { document.querySelector('#declare-input').value = n; }, expected);
    await page.click('#btn-declare');
    await wait(50);
    // Прицеливание
    await page.select('#aim-select', String(expected));
    let win = false;
    for (let i = 0; i < 6; i++){
      await page.click('#btn-fire');
      await wait(700);
      const ammo = await page.$eval('#ammo', e => parseInt(e.textContent, 10));
      const w = await page.evaluate(() => window.simulator.round.winner);
      if (w){ win = true; break; }
      if (ammo <= 0) await page.click('#btn-resupply');
    }
    assert.ok(win, 'не смогли поразить за 6 выстрелов');
  });

  console.log(failed === 0 ? '\n✅ ВСЕ ТЕСТЫ ЗЕЛЁНЫЕ' : `\n❌ ПРОВАЛ: ${failed}`);
  await browser.close();
  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
