// =============================================================
//  Симулятор «эфира» Радиофест-2025 (полигон с 9 мишенями)
// -------------------------------------------------------------
//  - Один источник правды: I/Q-семплы для 4 антенн (2 SDR × 2).
//  - Никакого реального оборудования: стенд абсолютно виртуальный.
//  - Геометрия как в регламенте: стена 3×3, дистанция ~2,5 м.
//  - Несущая 2,6 ГГц, AM-OOK, длительность импульса 250 мкс.
//  - Команды передают по очереди 8-символьные коды (первый '~').
// =============================================================

const C        = 299_792_458;       // скорость света, м/с
const F_RF     = 2.6e9;             // несущая, Гц
const LAMBDA   = C / F_RF;          // ≈ 0.1153 м
const BIT_US   = 250;               // длительность бита, мкс
const PREAMBLE = 0x7E;              // ~

// геометрия полигона (метры). z вглубь от антенн, x — азимут, y — высота.
const STAND_DISTANCE = 2.5;
const STAND_W = 1.5;   // ширина стенки
const STAND_H = 1.0;   // высота стенки
const ANT_SPACING = 0.05; // 5 см между парой антенн (≈ 0.43·λ)
// SDR-X (азимут): пара антенн вдоль X ; SDR-Y (угол места): пара антенн вдоль Y.

// 9 мишеней (1..9) — слева-направо, сверху-вниз
function makeTargets(){
  const t = [];
  let n = 1;
  for (let r = 0; r < 3; r++){
    for (let c = 0; c < 3; c++){
      const x = (c - 1) * STAND_W / 2;        // -W/2 ; 0 ; +W/2
      const y = (1 - r) * STAND_H / 2;        // +H/2 ; 0 ; -H/2 (строка 0 — верхняя)
      t.push({
        n, row:r, col:c,
        pos:{ x, y, z: STAND_DISTANCE },
        code: randomCode(),
        alive: true,
      });
      n++;
    }
  }
  return t;
}

function randomCode(){
  // 8 символов, первый '~', остальные 7 — буквы/цифры/символы
  const alpha = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789#$%&@';
  let s = '~';
  for (let i = 0; i < 7; i++) s += alpha[Math.floor(Math.random()*alpha.length)];
  return s;
}

function strBits(s){
  // 8 символов × 8 бит = 64 бита, MSB-first
  const bits = [];
  for (const ch of s){
    const c = ch.charCodeAt(0) & 0xFF;
    for (let b = 7; b >= 0; b--) bits.push((c >> b) & 1);
  }
  return bits;
}

// --- класс симулятора --------------------------------------
export class Simulator {
  constructor(){
    this.targets   = makeTargets();
    this.sampleRate = 200_000;     // Гц (200 кГц достаточно для бита 250 мкс — 50 семплов/бит)
    this.gainDb     = 20;
    this.tStart     = performance.now() / 1000;     // мониторим эфир сразу
    this.pyCursor   = 0;            // курсор «модельного времени» для Python-стрима

    // Активная мишень и схема расписания (как в регламенте — по очереди)
    this.slotMs   = 80;            // длительность «слота» одной мишени, мс
    this.guardMs  = 8;             // защитный интервал между слотами
    this.txOrder  = [...this.targets.map(t => t.n)];
    shuffle(this.txOrder);

    // Состояние раунда / судьи
    this.round = {
      active:false, startTime:0, stopTime:0,
      penaltyMs:0, ammo:3, declaredTarget:null, declaredAt:null,
      hits:new Set(), winner:false,
    };
    this.judgeCode  = '—';
    this.judgeTargetN = null;       // секрет: какая мишень загадана

    // Live-демодулятор (для табло)
    this.lastDecoded = '…';
  }

  // ---------- API сцены / судьи ----------
  startRound(){
    // выбираем загадан­ную мишень, объявляем её код
    this.regenerateCodes();
    const idx = Math.floor(Math.random() * this.targets.length);
    this.judgeTargetN = this.targets[idx].n;
    this.judgeCode    = this.targets[idx].code;
    this.round = {
      active:true, startTime:performance.now(), stopTime:0,
      penaltyMs:0, ammo:3, declaredTarget:null, declaredAt:null,
      hits:new Set(), winner:false,
    };
    return { code:this.judgeCode };
  }
  stopRound(){
    if (!this.round.active) return;
    this.round.active = false;
    this.round.stopTime = performance.now();
  }
  resetRound(){
    this.round = {
      active:false, startTime:0, stopTime:0,
      penaltyMs:0, ammo:3, declaredTarget:null, declaredAt:null,
      hits:new Set(), winner:false,
    };
    this.judgeCode = '—';
    this.judgeTargetN = null;
    this.targets.forEach(t => t.alive = true);
  }
  regenerateCodes(){
    // Кодовое поле перекодируется к каждому раунду
    for (const t of this.targets) t.code = randomCode();
  }
  declareTarget(n){
    if (!this.round.active) return { ok:false, msg:'Раунд не активен' };
    this.round.declaredTarget = n;
    this.round.declaredAt = performance.now();
    if (n !== this.judgeTargetN){
      this.round.penaltyMs += 60_000;
      return { ok:false, msg:`Заявлено №${n}. Неверно — штраф +60 с` };
    }
    return { ok:true, msg:`Заявлено №${n}. Принято.` };
  }
  fire(targetN){
    if (!this.round.active) return { ok:false, msg:'Раунд не активен' };
    if (this.round.declaredTarget == null)
      return { ok:false, msg:'Сначала объявите номер судье' };
    if (this.round.ammo <= 0)
      return { ok:false, msg:'Снаряды кончились — попроси у судьи (+10 с за пару)' };
    this.round.ammo -= 1;
    // 70% попадания при правильном прицеле, 0% при неправильном
    const target = this.targets.find(t => t.n === targetN);
    if (!target || !target.alive) return { ok:false, msg:'Мишень недоступна' };
    const hit = Math.random() < 0.72;
    if (hit){
      this.round.hits.add(targetN);
      target.alive = false;
      // Победа = поражена объявленная И загаданная мишень
      if (targetN === this.judgeTargetN && this.round.declaredTarget === this.judgeTargetN){
        this.round.winner = true;
        this.stopRound();
        return { ok:true, hit:true, win:true, msg:`Попадание! Победа за ${this.totalSec().toFixed(1)} с` };
      }
      // Если объявленная ≠ загаданной, нужно обе поразить (по регламенту)
      if (this.round.declaredTarget !== this.judgeTargetN
          && this.round.hits.has(this.round.declaredTarget)
          && this.round.hits.has(this.judgeTargetN)){
        this.round.winner = true;
        this.stopRound();
        return { ok:true, hit:true, win:true, msg:`Поражены обе. Время ${this.totalSec().toFixed(1)} с` };
      }
      return { ok:true, hit:true, msg:`Попадание по №${targetN}!` };
    }
    return { ok:true, hit:false, msg:`Промах по №${targetN}.` };
  }
  resupply(){
    if (!this.round.active) return;
    this.round.ammo += 2;
    this.round.penaltyMs += 10_000;
  }
  elapsedMs(){
    if (!this.round.active && this.round.stopTime === 0) return 0;
    const end = this.round.active ? performance.now() : this.round.stopTime;
    return end - this.round.startTime;
  }
  totalSec(){
    return (this.elapsedMs() + this.round.penaltyMs) / 1000;
  }

  // ---------- API SDR (используется и из JS, и из Python) ----------

  /**
   * Сгенерировать N семплов I/Q для конкретного SDR/антенны.
   * sdrIdx: 0 = X (азимут), 1 = Y (угол места)
   * antIdx: 0 = «−», 1 = «+»  (см. ANT_SPACING)
   * mode: 'live' — берёт текущее wall-clock время (для UI),
   *        'py'   — берёт модельный курсор и продвигает его (для Python-стрима).
   * Возвращает Float32Array длины 2*N (interleaved I,Q,I,Q...)
   */
  generateSamples(sdrIdx, antIdx, N, fc=F_RF, mode='live'){
    const fs = this.sampleRate;
    const dt = 1 / fs;
    const out = new Float32Array(2 * N);
    let t0;
    if (mode === 'py'){
      t0 = this.pyCursor;
      // продвигаем курсор после генерации
    } else {
      t0 = performance.now() / 1000 - this.tStart;
    }

    // Положение этой конкретной антенны
    // SDR-X разнесена по X (по горизонтали), SDR-Y — по Y (по вертикали).
    const sign = (antIdx === 0 ? -1 : +1) * 0.5;
    const ax = sdrIdx === 0 ? sign * ANT_SPACING : 0;
    const ay = sdrIdx === 1 ? sign * ANT_SPACING : 0;
    const az = 0;

    // Расписание: какой передатчик активен в каждом семпле
    const slotS  = this.slotMs / 1000;
    const guardS = this.guardMs / 1000;
    const cycleS = this.txOrder.length * (slotS + guardS);

    // Модель шума (комплексный гаусс)
    const sigmaN = Math.pow(10, -this.gainDb / 20) * 0.05;
    const lnaG   = Math.pow(10, this.gainDb / 20);

    // Ограничение полосы: если fc отстоит от F_RF — сигнал «вне канала»
    const detune = (fc - F_RF);
    // в комплексном baseband несущая обнуляется, но смещение dt влияет
    // как dop вращение фазы exp(j 2π·detune·t)
    // для правдоподобия игнорируем антенный отклик вне ±2 МГц
    const inBand = Math.abs(detune) < 2e6 ? 1 : 0;

    for (let i = 0; i < N; i++){
      const t = t0 + i * dt;
      // какая мишень активна?
      const phase = ((t % cycleS) + cycleS) % cycleS;
      const slotIdx = Math.floor(phase / (slotS + guardS));
      const localT  = phase - slotIdx * (slotS + guardS);
      let amp = 0;
      let activeTarget = null;
      if (localT < slotS){
        const txN = this.txOrder[slotIdx];
        activeTarget = this.targets.find(tg => tg.n === txN);
        if (activeTarget){
          // OOK: бит длительностью 250 мкс
          const bitIdx = Math.floor(localT * 1e6 / BIT_US);
          const bits = strBits(activeTarget.code);
          if (bitIdx < bits.length){
            amp = bits[bitIdx] ? 1 : 0;
          }
        }
      }

      let I = 0, Q = 0;
      if (amp > 0 && activeTarget && inBand){
        // Расстояние от антенны до источника
        const dx = activeTarget.pos.x - ax;
        const dy = activeTarget.pos.y - ay;
        const dz = activeTarget.pos.z - az;
        const r  = Math.hypot(dx, dy, dz);
        // Комплексная огибающая baseband: exp(-j·2π·r/λ) (фазовый сдвиг)
        // плюс вращение от расстройки fc-F_RF
        const phi = -2 * Math.PI * r / LAMBDA + 2 * Math.PI * detune * t;
        const a   = amp / r;             // 1/r — ослабление
        I = a * Math.cos(phi);
        Q = a * Math.sin(phi);
      }
      // Шум приёмника
      const [n1, n2] = gauss2();
      I = lnaG * I + sigmaN * n1;
      Q = lnaG * Q + sigmaN * n2;
      out[2*i]   = I;
      out[2*i+1] = Q;
    }

    // Live-декодер: на лету демодулируем последний слот
    this.lastDecoded = this.demodulateOOK(out);
    if (mode === 'py'){
      this.pyCursor = t0 + N * dt;
    }
    return out;
  }

  /** Простой AM/OOK демодулятор для отображения декодированной строки */
  demodulateOOK(iq){
    const N = iq.length / 2;
    const env = new Float32Array(N);
    let mx = 0, mn = Infinity;
    for (let i = 0; i < N; i++){
      const I = iq[2*i], Q = iq[2*i+1];
      env[i] = Math.hypot(I, Q);
      if (env[i] > mx) mx = env[i];
      if (env[i] < mn) mn = env[i];
    }
    if (mx - mn < 1e-3) return '…';
    const thr = (mx + mn) / 2;
    const samplesPerBit = Math.round(this.sampleRate * BIT_US / 1e6);
    if (samplesPerBit < 4) return '…';

    // Перебираем сдвиг (offset) внутри одного бита, чтобы попасть в его середину
    const offsets = [0, samplesPerBit >> 2, samplesPerBit >> 1, (3*samplesPerBit) >> 2];
    for (const off of offsets){
      // soft-bits → биты
      const bits = [];
      for (let i = off; i + samplesPerBit <= N; i += samplesPerBit){
        let s = 0;
        for (let j = 0; j < samplesPerBit; j++) s += env[i+j];
        bits.push((s / samplesPerBit) > thr ? 1 : 0);
      }
      // Перебираем все 8 битовых сдвигов байтовой выравнивания
      for (let bitShift = 0; bitShift < 8; bitShift++){
        if (bits.length - bitShift < 64) continue;
        // упаковать байты, начиная с bitShift
        const bytes = [];
        for (let i = bitShift; i + 8 <= bits.length; i += 8){
          let b = 0;
          for (let k = 0; k < 8; k++) b = (b << 1) | bits[i+k];
          bytes.push(b);
        }
        // Найти '~' и вернуть 8 печатных символов
        for (let i = 0; i + 8 <= bytes.length; i++){
          if (bytes[i] === PREAMBLE){
            let s = '', ok = true;
            for (let j = 0; j < 8; j++){
              const b = bytes[i+j];
              if (b < 32 || b > 126){ ok = false; break; }
              s += String.fromCharCode(b);
            }
            if (ok) return s;
          }
        }
      }
    }
    return '?';
  }

  /** Стрим-обёртка: используется и из JS, и из Python мока. */
  setupStream(channels=[0,1]){
    // На каждом setupStream сбрасываем курсор «эфирного времени» Python-стороны:
    // сейчас (tNow) → плюс продвижение по 4096 семплам после каждого readStream.
    this.pyCursor = performance.now() / 1000 - this.tStart;
    return { channels, mtu: 4096 };
  }

  /** Удобный шорткат для Python-мока. */
  pyReadSamples(sdrIdx, antIdx, N, fc=F_RF){
    return this.generateSamples(sdrIdx, antIdx, N, fc, 'py');
  }

  /** Длинный буфер (для надёжного UI-декодирования OOK). */
  decodeWindow(N=8192, sdrIdx=0, antIdx=0, fc=F_RF){
    const buf = this.generateSamples(sdrIdx, antIdx, N, fc, 'live');
    return this.demodulateOOK(buf);
  }
}

// ---------- утилиты ---------
function gauss2(){
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const r  = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2*Math.PI*u2), r * Math.sin(2*Math.PI*u2)];
}
function shuffle(a){
  for (let i = a.length-1; i > 0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
}

// Глобальный единственный экземпляр (его видит и Pyodide через `from js import simulator`)
export const simulator = new Simulator();

// Экспортим в window — чтобы Python мог `from js import simulator`
if (typeof window !== 'undefined'){
  window.simulator = simulator;
}
