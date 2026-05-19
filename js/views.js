// Визуализаторы для панели «Эфир»: спектр, водопад, I/Q, фазометр.
import { powerSpectrumDB } from './fft.js';

export class SpectrumView {
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
  }
  draw(iq, fs, fc){
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    const N = 1024;
    const spec = powerSpectrumDB(iq, N);
    ctx.fillStyle = '#05090f'; ctx.fillRect(0,0,W,H);

    // сетка
    ctx.strokeStyle = '#16263a'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= 10; i++){
      const x = (W * i / 10) | 0;
      ctx.moveTo(x+0.5, 0); ctx.lineTo(x+0.5, H);
    }
    for (let i = 0; i <= 6; i++){
      const y = (H * i / 6) | 0;
      ctx.moveTo(0, y+0.5); ctx.lineTo(W, y+0.5);
    }
    ctx.stroke();

    // подписи частот
    ctx.fillStyle = '#7d8ea0'; ctx.font = '10px ui-monospace,monospace';
    for (let i = 0; i <= 10; i++){
      const fkHz = ((-fs/2 + fs * i / 10) / 1000);
      const x = (W * i / 10);
      ctx.fillText(fkHz.toFixed(0)+' kHz', x + 2, H - 4);
    }
    ctx.fillText(`Fc = ${(fc/1e9).toFixed(3)} GHz`, 4, 12);

    // спектр
    ctx.strokeStyle = '#3fe07a'; ctx.lineWidth = 1.4; ctx.beginPath();
    const dbMin = -80, dbMax = 0;
    for (let i = 0; i < N; i++){
      const x = i * W / (N-1);
      const y = H - (spec[i] - dbMin) / (dbMax - dbMin) * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export class WaterfallView {
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.line = canvas.width;
    this.img = this.ctx.createImageData(canvas.width, 1);
  }
  draw(iq, fs){
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    const N = 1024;
    const spec = powerSpectrumDB(iq, N);
    // Скроллим вниз на 1 пиксель
    const prev = ctx.getImageData(0, 0, W, H-1);
    ctx.putImageData(prev, 0, 1);
    // Рисуем верхнюю строку
    const row = ctx.createImageData(W, 1);
    for (let x = 0; x < W; x++){
      const i  = Math.floor(x * (N-1) / (W-1));
      const db = spec[i];
      const v  = Math.max(0, Math.min(1, (db + 80) / 80));
      const [r,g,b] = magma(v);
      row.data[4*x  ] = r;
      row.data[4*x+1] = g;
      row.data[4*x+2] = b;
      row.data[4*x+3] = 255;
    }
    ctx.putImageData(row, 0, 0);
    // подпись
    ctx.fillStyle = '#7d8ea0'; ctx.font = '10px ui-monospace';
    ctx.fillText(`fs=${(fs/1000).toFixed(0)} kHz · водопад ↓`, 6, H-6);
  }
}

// LUT magma-like
function magma(t){
  const stops = [
    [0,   [0,0,0]],
    [0.25,[40,0,80]],
    [0.5, [180,30,90]],
    [0.75,[250,140,40]],
    [1.0, [255,255,180]],
  ];
  for (let i = 1; i < stops.length; i++){
    if (t <= stops[i][0]){
      const a = stops[i-1], b = stops[i];
      const u = (t - a[0]) / (b[0] - a[0]);
      return [
        a[1][0] + (b[1][0]-a[1][0])*u | 0,
        a[1][1] + (b[1][1]-a[1][1])*u | 0,
        a[1][2] + (b[1][2]-a[1][2])*u | 0,
      ];
    }
  }
  return [255,255,180];
}

export class IQView {
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
  }
  draw(iq, fs){
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.fillStyle = '#05090f'; ctx.fillRect(0,0,W,H);
    const halfH = H / 2;

    // grid
    ctx.strokeStyle = '#16263a'; ctx.beginPath();
    ctx.moveTo(0, halfH+0.5); ctx.lineTo(W*0.7, halfH+0.5);
    ctx.moveTo(0, halfH/2+0.5); ctx.lineTo(W*0.7, halfH/2+0.5);
    ctx.moveTo(0, 1.5*halfH+0.5); ctx.lineTo(W*0.7, 1.5*halfH+0.5);
    ctx.stroke();

    // огибающая (envelope) — слева 70%
    const N = iq.length / 2;
    const Wleft = (W * 0.7) | 0;
    const step = Math.max(1, Math.floor(N / Wleft));
    let mx = 1e-6;
    const env = new Float32Array(Wleft);
    const Idata = new Float32Array(Wleft);
    const Qdata = new Float32Array(Wleft);
    for (let x = 0; x < Wleft; x++){
      const i = Math.min(N-1, x * step);
      const I = iq[2*i], Q = iq[2*i+1];
      Idata[x] = I; Qdata[x] = Q;
      env[x] = Math.hypot(I, Q);
      if (env[x] > mx) mx = env[x];
    }

    // I (cyan), Q (violet), env (green)
    drawTrace(ctx, Idata, 0, halfH/2, Wleft, halfH, mx, '#5cb8ff');
    drawTrace(ctx, Qdata, 0, halfH/2 + halfH, Wleft, halfH, mx, '#b48bff');
    ctx.font = '10px ui-monospace'; ctx.fillStyle = '#7d8ea0';
    ctx.fillText('I (real)',    6, 12);
    ctx.fillText('Q (imag)',    6, halfH + 12);
    ctx.fillText('|I+jQ| envelope (правая панель — констелляция)', 6, H-6);

    // Constellation справа 30%
    const Wright = W - Wleft;
    const cx = Wleft + Wright/2, cy = H/2;
    ctx.strokeStyle = '#16263a';
    ctx.strokeRect(Wleft, 0, Wright-1, H);
    ctx.beginPath();
    ctx.moveTo(Wleft+1, cy); ctx.lineTo(W-1, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.fillStyle = '#3fe07a';
    const scale = (Math.min(Wright, H) * 0.42) / mx;
    for (let i = 0; i < N; i += 4){
      const I = iq[2*i], Q = iq[2*i+1];
      const x = cx + I * scale;
      const y = cy - Q * scale;
      ctx.fillRect(x|0, y|0, 1, 1);
    }
    ctx.fillStyle = '#7d8ea0';
    ctx.fillText('Constellation (I,Q)', Wleft+6, 12);
  }
}

function drawTrace(ctx, arr, x0, yMid, W, H, scale, color){
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x < arr.length; x++){
    const y = yMid - (arr[x] / scale) * (H/2 - 4);
    if (x === 0) ctx.moveTo(x0+x, y); else ctx.lineTo(x0+x, y);
  }
  ctx.stroke();
}

/** Фазометр: показывает Δφ между антеннами 0 и 1 для текущего активного передатчика. */
export class PhaseView {
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.history = []; // последние Δφ
  }
  draw(iq0, iq1){
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.fillStyle = '#05090f'; ctx.fillRect(0,0,W,H);

    // вычислить взвешенный Δφ только когда амплитуда > порога
    const N = iq0.length / 2;
    let sumI = 0, sumQ = 0, sumE = 0;
    for (let i = 0; i < N; i++){
      const I0 = iq0[2*i], Q0 = iq0[2*i+1];
      const I1 = iq1[2*i], Q1 = iq1[2*i+1];
      const e0 = Math.hypot(I0,Q0), e1 = Math.hypot(I1,Q1);
      const e  = Math.min(e0, e1);
      // s1 * conj(s0)
      const cr = I1*I0 + Q1*Q0;
      const ci = Q1*I0 - I1*Q0;
      sumI += cr * e;
      sumQ += ci * e;
      sumE += e;
    }
    const dphi = (sumE > 0) ? Math.atan2(sumQ, sumI) : NaN;
    if (!isNaN(dphi)){
      this.history.push(dphi);
      if (this.history.length > 80) this.history.shift();
    }

    const cx = H/2 + 20, cy = H/2;
    const r  = H/2 - 14;

    // компас
    ctx.strokeStyle = '#16263a'; ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2*Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-r, cy); ctx.lineTo(cx+r, cy);
    ctx.moveTo(cx, cy-r); ctx.lineTo(cx, cy+r); ctx.stroke();
    ctx.fillStyle = '#7d8ea0'; ctx.font = '10px ui-monospace';
    ctx.fillText('-π', cx - r - 14, cy+3);
    ctx.fillText('+π', cx + r + 4,  cy+3);
    ctx.fillText('Δφ = ∠(s₁·s₀*) → пеленг', cx + r + 18, 14);

    if (!isNaN(dphi)){
      // стрелка
      ctx.strokeStyle = '#3fe07a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + r * Math.cos(dphi), cy - r * Math.sin(dphi));
      ctx.stroke();
      ctx.fillStyle = '#3fe07a';
      ctx.font = '13px ui-monospace';
      ctx.fillText(`Δφ = ${(dphi*180/Math.PI).toFixed(1)}°`,
                   cx + r + 18, 36);
      // рекомендуемая колонка/строка
      // sin(θ) ≈ Δφ·λ / (2π·d).  λ/d = 1/0.43 → multiplier
      const sinTheta = dphi / (2*Math.PI * 0.05 / 0.1153);
      const clipped  = Math.max(-1, Math.min(1, sinTheta));
      const thetaDeg = Math.asin(clipped) * 180/Math.PI;
      ctx.fillStyle = '#5cb8ff';
      ctx.fillText(`θ ≈ ${thetaDeg.toFixed(1)}°`, cx + r + 18, 56);
      const slot = thetaDeg < -8 ? '−' : thetaDeg > 8 ? '+' : '0';
      ctx.fillStyle = '#f6c453';
      ctx.fillText(`класс: ${slot}`, cx + r + 18, 76);
    } else {
      ctx.fillStyle = '#7d8ea0';
      ctx.fillText('эфир тих — ждём слот', cx + r + 18, 36);
    }

    // история
    ctx.strokeStyle = '#5cb8ff'; ctx.lineWidth = 1; ctx.beginPath();
    const x0 = 8, y0 = H - 6;
    for (let i = 0; i < this.history.length; i++){
      const x = x0 + i * 2.4;
      const y = y0 - ((this.history[i] + Math.PI) / (2*Math.PI)) * (H - 30);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
