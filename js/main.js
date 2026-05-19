import { simulator } from './simulator.js';
import { SpectrumView, WaterfallView, IQView, PhaseView } from './views.js';
import { Scene } from './scene.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

// ---------- сцена ----------
const sceneCv = $('#scene');
const scene   = new Scene(sceneCv, simulator);

// ---------- эфир ----------
const spectrumView  = new SpectrumView ($('#spectrum'));
const waterfallView = new WaterfallView($('#waterfall'));
const iqView        = new IQView       ($('#iq'));
const phaseView     = new PhaseView    ($('#phase'));

let activeSdrTab = 'spectrum';
$$('.sdr-tabs .tab').forEach(b => b.addEventListener('click', () => {
  $$('.sdr-tabs .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  activeSdrTab = b.dataset.tab;
  ['spectrum','waterfall','iq','phase'].forEach(id => $('#'+id).hidden = id !== activeSdrTab);
}));

$$('.docs-tab').forEach(b => b.addEventListener('click', () => {
  $$('.docs-tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.docs-pane').forEach(p => p.classList.remove('active'));
  $(`.docs-pane[data-pane="${b.dataset.tab}"]`).classList.add('active');
}));

// ---------- селектор мишени ----------
const aimSelect = $('#aim-select');
for (let i = 1; i <= 9; i++){
  const o = document.createElement('option');
  o.value = i; o.textContent = `№ ${i}`;
  aimSelect.appendChild(o);
}

// ---------- судья / раунд ----------
function refreshJudgePanel(){
  $('#judge-code').textContent = simulator.judgeCode;
  $('#timer').textContent      = fmtMs(simulator.elapsedMs());
  $('#penalty').textContent    = fmtMs(simulator.round.penaltyMs);
  $('#total-time').textContent = fmtMs(simulator.elapsedMs() + simulator.round.penaltyMs);
  $('#ammo').textContent       = simulator.round.ammo;
}
function fmtMs(ms){
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = (s - 60*m);
  return `${String(m).padStart(2,'0')}:${r.toFixed(1).padStart(4,'0')}`;
}

$('#btn-start').addEventListener('click', () => {
  const r = simulator.startRound();
  $('#declared-status').textContent = `Раунд начат. Ищите код «${r.code}» в эфире.`;
  refreshJudgePanel();
});
$('#btn-stop').addEventListener('click', () => { simulator.stopRound(); refreshJudgePanel(); });
$('#btn-reset').addEventListener('click', () => {
  simulator.resetRound();
  $('#declared-status').textContent = '';
  refreshJudgePanel();
});

$('#btn-declare').addEventListener('click', () => {
  const n = parseInt($('#declare-input').value, 10);
  const r = simulator.declareTarget(n);
  $('#declared-status').textContent = r.msg;
  refreshJudgePanel();
});
$('#btn-fire').addEventListener('click', () => {
  const n = parseInt(aimSelect.value, 10);
  const r = simulator.fire(n);
  if (r.ok) scene.fire(n);
  $('#declared-status').textContent = r.msg + (r.win ? ' 🏆' : '');
  refreshJudgePanel();
});
$('#btn-resupply').addEventListener('click', () => { simulator.resupply(); refreshJudgePanel(); });

// ---------- SDR контролы ----------
const sdrSelect  = $('#sdr-select');
const antSelect  = $('#ant-select');
const freqInput  = $('#freq-input');
const rateInput  = $('#rate-input');
const gainInput  = $('#gain-input');
$('#gain-input').addEventListener('input', e => {
  $('#gain-val').textContent = e.target.value;
  simulator.gainDb = parseFloat(e.target.value);
});
$('#rate-input').addEventListener('change', e => {
  simulator.sampleRate = parseFloat(e.target.value) * 1000;
});

// ---------- цикл рендера ----------
let tickCount = 0;
let lastGoodDecoded = '…';
function tick(){
  // эфир: используем выбранный SDR/антенну
  const sdr = parseInt(sdrSelect.value, 10);
  const ant = parseInt(antSelect.value, 10);
  const fc  = parseFloat(freqInput.value) * 1e9;
  const N   = 1024;
  const iq  = simulator.generateSamples(sdr, ant, N, fc);

  if (activeSdrTab === 'spectrum') spectrumView.draw(iq, simulator.sampleRate, fc);
  else if (activeSdrTab === 'waterfall') waterfallView.draw(iq, simulator.sampleRate);
  else if (activeSdrTab === 'iq') iqView.draw(iq, simulator.sampleRate);
  else if (activeSdrTab === 'phase'){
    const iq0 = simulator.generateSamples(sdr, 0, N, fc);
    const iq1 = simulator.generateSamples(sdr, 1, N, fc);
    phaseView.draw(iq0, iq1);
  }
  // Длинное окно для надёжной табло-надписи (раз в 4 кадра)
  if ((tickCount++ & 3) === 0){
    const decoded = simulator.decodeWindow(16384, sdr, ant, fc);
    if (decoded && decoded !== '?' && decoded !== '…'){
      lastGoodDecoded = decoded;
    }
  }
  $('#decoded-code').textContent = lastGoodDecoded;

  scene.draw();
  refreshJudgePanel();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ===================================================================
//  Pyodide + мок SoapySDR
// ===================================================================

let pyodide = null;
const pyOutput = $('#py-output');
const pyEditor = $('#editor');
const pyLoading = $('#py-loading');
const pyArea = $('#py-area');

async function loadPyodide_(){
  pyodide = await window.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
  });
  await pyodide.loadPackage(['numpy']);
  // Скачать наш мок и положить в виртуальную ФС
  const py = await fetch('py/SoapySDR.py').then(r => r.text());
  pyodide.FS.writeFile('SoapySDR.py', py);
  // Хелперы
  const helpers = await fetch('py/radiofest_helpers.py').then(r => r.text());
  pyodide.FS.writeFile('radiofest_helpers.py', helpers);
  pyodide.setStdout({ batched: txt => pyOutput.textContent += txt + '\n' });
  pyodide.setStderr({ batched: txt => pyOutput.textContent += '! ' + txt + '\n' });
  pyLoading.hidden = true;
  pyArea.hidden = false;
  loadExample('hello');
}
loadPyodide_().catch(err => {
  pyLoading.textContent = 'Не удалось загрузить Pyodide: ' + err.message
    + '\nПроверьте сеть. Питон-песочница оффлайн, остальная часть стенда работает.';
});

const EXAMPLES = {
  hello: `# 01 — Привет, SDR!
import SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32

sdr = SoapySDR.Device({"driver":"lime", "index":0})  # SDR-X
print("device:", sdr)
sdr.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
sdr.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)
sdr.setGain      (SOAPY_SDR_RX, 0, "LNA", 25)
print("fs =", sdr.getSampleRate(SOAPY_SDR_RX, 0), "Hz")
print("fc =", sdr.getFrequency (SOAPY_SDR_RX, 0)/1e9, "GHz")
`,

  capture: `# 02 — Захват одного буфера и грубый спектр
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32

sdr = SoapySDR.Device({"driver":"lime", "index":0})
sdr.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
sdr.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)
sdr.setGain      (SOAPY_SDR_RX, 0, "LNA", 25)

st = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0])
sdr.activateStream(st)
buf = np.zeros(4096, np.complex64)
sdr.readStream(st, [buf], 4096)
sdr.deactivateStream(st); sdr.closeStream(st)

spec = np.fft.fftshift(np.fft.fft(buf*np.hanning(len(buf))))
db   = 20*np.log10(np.abs(spec)+1e-9)
print("max bin (dB):", db.max().round(1), " peak idx:", int(np.argmax(db)))
print("первые 10 семплов I/Q:")
for x in buf[:10]: print(f"  {x.real:+.3f}  {x.imag:+.3f}j")
`,

  ook: `# 03 — Демодуляция AM/OOK и поиск преамбулы '~'
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32

sdr = SoapySDR.Device({"driver":"lime", "index":0})
sdr.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
sdr.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)

st = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0])
sdr.activateStream(st)
buf = np.zeros(40000, np.complex64)         # ~200 мс
sdr.readStream(st, [buf], len(buf))
sdr.deactivateStream(st); sdr.closeStream(st)

env = np.abs(buf)
spb = int(200e3 * 250e-6)   # семплов на бит = 50

thr = (env.max() + env.min()) / 2
bits = (env[:len(env)//spb*spb].reshape(-1, spb).mean(1) > thr).astype(int)

# собрать байты
b = np.packbits(bits[: (len(bits)//8)*8])
# поиск '~' (0x7E)
pre = np.where(b == 0x7E)[0]
print("преамбулы найдены в позициях (байты):", pre[:5])
for p in pre[:3]:
    if p+8 <= len(b):
        s = b[p:p+8].tobytes().decode("ascii", "replace")
        if all(32 <= c < 127 for c in b[p:p+8]):
            print("  ->", repr(s))
`,

  df: `# 04 — Пеленг (фазовый интерферометр) по Δφ между антеннами 0 и 1
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32

# SDR-X (азимут)
sdr = SoapySDR.Device({"driver":"lime", "index":0})
sdr.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
sdr.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)
st = sdr.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0, 1])
sdr.activateStream(st)
N = 8192
b0 = np.zeros(N, np.complex64); b1 = np.zeros(N, np.complex64)
sdr.readStream(st, [b0, b1], N)
sdr.deactivateStream(st); sdr.closeStream(st)

# Δφ = ∠( s1 · conj(s0) ), взвешиваем по огибающей
e = np.minimum(np.abs(b0), np.abs(b1))
prod = b1 * np.conj(b0) * e
dphi = np.angle(prod.sum())
print(f"Δφ_x = {np.degrees(dphi):+.1f}°")

# d/λ ≈ 0.05/0.1153 = 0.434
LAMBDA = 0.1153; d = 0.05
sin_th = dphi / (2*np.pi*d/LAMBDA)
sin_th = np.clip(sin_th, -1, 1)
theta  = np.degrees(np.arcsin(sin_th))
print(f"азимут θ_x ≈ {theta:+.1f}°  → колонка:",
      "−" if theta < -8 else ("+" if theta > 8 else "0"))
`,

  full: `# 05 — Полное решение задачи Радиофест-2025
# 1) принять эфир обоими SDR; 2) найти пакет с целевым кодом;
# 3) посчитать пеленг по окну этого пакета; 4) определить № мишени.
import numpy as np, SoapySDR
from SoapySDR import SOAPY_SDR_RX, SOAPY_SDR_CF32
from radiofest_helpers import find_packet, est_phase, target_number, judge_code

target_code = judge_code()
print("код от судьи:", target_code)

def open_sdr(idx):
    s = SoapySDR.Device({"driver":"lime","index":idx})
    s.setSampleRate(SOAPY_SDR_RX, 0, 200e3)
    s.setFrequency (SOAPY_SDR_RX, 0, 2.6e9)
    s.setGain      (SOAPY_SDR_RX, 0, "LNA", 25)
    return s

sdr_x, sdr_y = open_sdr(0), open_sdr(1)
stx = sdr_x.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0,1]); sdr_x.activateStream(stx)
sty = sdr_y.setupStream(SOAPY_SDR_RX, SOAPY_SDR_CF32, [0,1]); sdr_y.activateStream(sty)

found = None
N = 24000          # 120 мс при 200 кГц — гарантированно один полный слот целиком
for attempt in range(20):
    bx0=np.zeros(N,np.complex64); bx1=np.zeros(N,np.complex64)
    by0=np.zeros(N,np.complex64); by1=np.zeros(N,np.complex64)
    sdr_x.readStream(stx, [bx0, bx1], N)
    sdr_y.readStream(sty, [by0, by1], N)

    win = find_packet(bx0, target_code)
    if win is not None:
        # пеленгуем строго по окну, где наша мишень была активна
        dphi_x = est_phase(bx0, bx1, window=win)
        dphi_y = est_phase(by0, by1, window=win)
        n = target_number(dphi_x, dphi_y)
        print(f"[{attempt}] found code {target_code!r} в [{win[0]},{win[1]}],"
              f" Δφ_x={np.degrees(dphi_x):+.1f}°  Δφ_y={np.degrees(dphi_y):+.1f}°"
              f"  №={n}")
        found = n
        break
    else:
        print(f"[{attempt}] нашего кода ещё не было в эфире, ждём…")

if found:
    print(f"\\n→ объявите судье №{found} и стреляйте по №{found}")
else:
    print("не пойман — попробуйте ещё раз")
`,
};

function loadExample(key){
  pyEditor.value = EXAMPLES[key] || EXAMPLES.hello;
}
$('#py-examples').addEventListener('change', e => {
  if (e.target.value) loadExample(e.target.value);
});
$('#btn-clear').addEventListener('click', () => pyOutput.textContent = '');

async function runPython(){
  if (!pyodide){ pyOutput.textContent += 'Pyodide ещё грузится…\n'; return; }
  pyOutput.textContent += '>>> запуск\n';
  try {
    await pyodide.runPythonAsync(pyEditor.value);
  } catch(e){
    pyOutput.textContent += '! ' + e.message + '\n';
  }
}
$('#btn-run').addEventListener('click', runPython);
pyEditor.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); runPython(); }
});
