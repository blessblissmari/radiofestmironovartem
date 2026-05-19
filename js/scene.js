// Сцена полигона: стенка с 9 мишенями, 4 антенны (X-/+, Y-/+), танк, выстрелы.
export class Scene {
  constructor(canvas, sim){
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
    this.shots = [];   // снаряды в полёте
    this.flashes = []; // вспышки от попаданий
  }

  fire(targetN){
    const t = this.sim.targets.find(x => x.n === targetN);
    if (!t) return false;
    // приоткрыть панель — сцена сама нарисует траекторию
    const px = this.targetPx(targetN);
    this.shots.push({
      x: this.tankX(), y: this.tankY()-18,
      tx: px.x, ty: px.y, t: 0, target: targetN,
    });
    return true;
  }

  tankX(){ return this.cv.width * 0.5; }
  tankY(){ return this.cv.height - 50; }

  targetPx(n){
    const t = this.sim.targets.find(x => x.n === n);
    const stand = this.standRect();
    const cellW = stand.w / 3, cellH = stand.h / 3;
    return {
      x: stand.x + (t.col + 0.5) * cellW,
      y: stand.y + (t.row + 0.5) * cellH,
    };
  }

  standRect(){
    const W = this.cv.width, H = this.cv.height;
    const w = W * 0.55, h = H * 0.42;
    return { x: (W - w)/2, y: H * 0.10, w, h };
  }

  draw(){
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    // фон
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, '#0a1828');
    g.addColorStop(0.65, '#0a1018');
    g.addColorStop(1, '#091014');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

    // сетка пола (перспектива)
    ctx.strokeStyle = '#13283d'; ctx.lineWidth = 1;
    const horiz = H * 0.55;
    for (let i = 1; i < 18; i++){
      const t = i / 18;
      const y = horiz + (H - horiz) * t * t;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = -10; i <= 10; i++){
      const xf = W/2 + i * (W/22);
      ctx.beginPath();
      ctx.moveTo(W/2, horiz);
      ctx.lineTo(xf, H);
      ctx.stroke();
    }

    // стенка с мишенями
    const s = this.standRect();
    ctx.fillStyle = '#1a2638';
    ctx.fillRect(s.x-8, s.y-8, s.w+16, s.h+16);
    ctx.strokeStyle = '#2c4060'; ctx.strokeRect(s.x-8, s.y-8, s.w+16, s.h+16);
    const cellW = s.w/3, cellH = s.h/3;
    const round = this.sim.round;

    for (let r = 0; r < 3; r++){
      for (let c = 0; c < 3; c++){
        const t = this.sim.targets.find(x => x.row===r && x.col===c);
        const x = s.x + c*cellW, y = s.y + r*cellH;
        const cx = x + cellW/2, cy = y + cellH/2;
        const rad = Math.min(cellW, cellH) * 0.42;

        // активный передатчик в эфире прямо сейчас?
        const cycleS = this.sim.txOrder.length * (this.sim.slotMs + this.sim.guardMs) / 1000;
        const tNow = (performance.now()/1000 - this.sim.tStart) % cycleS;
        const slotS = this.sim.slotMs / 1000;
        const guardS = this.sim.guardMs / 1000;
        const slotIdx = Math.floor(tNow / (slotS + guardS));
        const localT  = tNow - slotIdx * (slotS + guardS);
        const txN = this.sim.txOrder[slotIdx];
        const isActive = localT < slotS && txN === t.n;

        // концентрические круги мишени
        for (let k = 4; k > 0; k--){
          ctx.beginPath();
          ctx.arc(cx, cy, rad * k/4, 0, 2*Math.PI);
          ctx.fillStyle = (k%2===0) ? '#e9eef3' : '#cf2a2a';
          if (!t.alive) ctx.fillStyle = (k%2===0) ? '#3a3a3a' : '#5a1f1f';
          ctx.fill();
        }
        // bullseye
        ctx.beginPath();
        ctx.arc(cx, cy, rad*0.12, 0, 2*Math.PI);
        ctx.fillStyle = t.alive ? '#0e0e0e' : '#222';
        ctx.fill();

        // подпись номера
        ctx.fillStyle = '#0a0a0a'; ctx.font = 'bold 14px ui-monospace,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(t.n), cx, cy);

        // подсветка активной
        if (isActive && t.alive){
          ctx.strokeStyle = '#3fe07a'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, rad+4, 0, 2*Math.PI); ctx.stroke();
          // волна
          const w = (performance.now() % 600)/600;
          ctx.strokeStyle = `rgba(63,224,122,${1-w})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, rad + 4 + w*16, 0, 2*Math.PI); ctx.stroke();
        }
        // знак "поражена"
        if (!t.alive){
          ctx.strokeStyle = '#ff5c5c'; ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(cx - rad*0.6, cy - rad*0.6);
          ctx.lineTo(cx + rad*0.6, cy + rad*0.6);
          ctx.moveTo(cx + rad*0.6, cy - rad*0.6);
          ctx.lineTo(cx - rad*0.6, cy + rad*0.6);
          ctx.stroke();
        }
        // код мишени мелко (для отладки/обучения, видно только хост-команде)
        ctx.font = '10px ui-monospace'; ctx.textAlign='center';
        ctx.fillStyle = '#7d8ea0';
        ctx.fillText(t.code, cx, y + cellH - 4);
      }
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // антенны: пара по X (низ) — у танка слева/справа, пара по Y — слева на стойке
    this.drawAntennaPair(this.tankX()-90, this.tankY()-10,
                         this.tankX()+90, this.tankY()-10,
                         'SDR-X (азимут)');
    this.drawAntennaPair(60, H*0.30, 60, H*0.65, 'SDR-Y (угол места)');

    // танк
    this.drawTank(this.tankX(), this.tankY());

    // снаряды
    const dt = 1/60;
    for (let i = this.shots.length-1; i >= 0; i--){
      const s = this.shots[i];
      s.t += dt;
      const u = Math.min(1, s.t / 0.55);
      const x = s.x + (s.tx - s.x)*u;
      const y = s.y + (s.ty - s.y)*u - Math.sin(u*Math.PI) * 60;
      ctx.fillStyle = '#f6c453';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2*Math.PI); ctx.fill();
      ctx.strokeStyle = 'rgba(246,196,83,.4)';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo((s.x+s.tx)/2, Math.min(s.y, s.ty)-80, x, y);
      ctx.stroke();
      if (u >= 1){
        this.flashes.push({ x: s.tx, y: s.ty, t: 0, target: s.target });
        this.shots.splice(i, 1);
      }
    }
    // вспышки
    for (let i = this.flashes.length-1; i >= 0; i--){
      const f = this.flashes[i]; f.t += dt;
      const r = 6 + f.t * 80;
      ctx.strokeStyle = `rgba(255,140,40,${1 - f.t*1.6})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 2*Math.PI); ctx.stroke();
      if (f.t > 0.6) this.flashes.splice(i, 1);
    }
  }

  drawAntennaPair(x1,y1,x2,y2,label){
    const ctx = this.ctx;
    drawAnt(ctx, x1, y1);
    drawAnt(ctx, x2, y2);
    ctx.strokeStyle = '#365b85'; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7d8ea0'; ctx.font = '11px ui-monospace';
    ctx.fillText(label, (x1+x2)/2 - 60, (y1+y2)/2 + 4);
  }

  drawTank(cx, cy){
    const ctx = this.ctx;
    // тень
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.ellipse(cx, cy+12, 60, 8, 0, 0, 2*Math.PI); ctx.fill();
    // корпус
    ctx.fillStyle = '#3a4d2c';
    roundRect(ctx, cx-50, cy-12, 100, 22, 4); ctx.fill();
    // гусеницы
    ctx.fillStyle = '#1d1d1d';
    roundRect(ctx, cx-55, cy+8, 110, 10, 3); ctx.fill();
    // башня
    ctx.fillStyle = '#4b6238';
    roundRect(ctx, cx-22, cy-26, 44, 18, 3); ctx.fill();
    // ствол
    ctx.fillStyle = '#1d1d1d';
    ctx.fillRect(cx-2, cy-50, 4, 28);
    // канат
    ctx.fillStyle = '#caf3d8'; ctx.font='10px ui-monospace';
    ctx.fillText('TANK', cx-13, cy-1);
  }
}

function drawAnt(ctx, x, y){
  ctx.strokeStyle = '#5cb8ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y-22); ctx.stroke();
  ctx.fillStyle = '#5cb8ff';
  ctx.beginPath(); ctx.arc(x, y-24, 3, 0, 2*Math.PI); ctx.fill();
  ctx.fillRect(x-7, y, 14, 4);
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}
