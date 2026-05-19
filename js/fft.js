// Радикс-2 FFT in-place (cooley-tukey).  Минималистичная и быстрая.
// Принимает interleaved Float32Array [I0, Q0, I1, Q1, ...] длиной 2N (N — степень 2).
export function fftInPlace(buf){
  const N = buf.length / 2;
  // Bit-reverse permutation
  let j = 0;
  for (let i = 0; i < N; i++){
    if (i < j){
      const ti = buf[2*i],   tq = buf[2*i+1];
      buf[2*i]   = buf[2*j];
      buf[2*i+1] = buf[2*j+1];
      buf[2*j]   = ti;
      buf[2*j+1] = tq;
    }
    let m = N >> 1;
    while (m >= 1 && j >= m){ j -= m; m >>= 1; }
    j += m;
  }
  for (let s = 1, size = 2; size <= N; s++, size <<= 1){
    const half = size >> 1;
    const theta = -2 * Math.PI / size;
    const wpr = Math.cos(theta), wpi = Math.sin(theta);
    for (let k = 0; k < N; k += size){
      let wr = 1, wi = 0;
      for (let m = 0; m < half; m++){
        const i1 = 2*(k + m);
        const i2 = 2*(k + m + half);
        const tr = wr * buf[i2]   - wi * buf[i2+1];
        const ti = wr * buf[i2+1] + wi * buf[i2];
        buf[i2]   = buf[i1]   - tr;
        buf[i2+1] = buf[i1+1] - ti;
        buf[i1]   = buf[i1]   + tr;
        buf[i1+1] = buf[i1+1] + ti;
        const wrn = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = wrn;
      }
    }
  }
}

/** Спектр мощности в дБ.  Возвращает Float32Array длиной N (с fftshift'ом). */
export function powerSpectrumDB(iqInterleaved, N){
  // Окно Хэннинга
  const buf = new Float32Array(2*N);
  for (let i = 0; i < N; i++){
    const w = 0.5 * (1 - Math.cos(2*Math.PI*i / (N-1)));
    buf[2*i]   = iqInterleaved[2*i]   * w;
    buf[2*i+1] = iqInterleaved[2*i+1] * w;
  }
  fftInPlace(buf);
  const out = new Float32Array(N);
  // fftshift: [N/2..N-1, 0..N/2-1]
  for (let i = 0; i < N; i++){
    const k = (i + (N>>1)) % N;
    const re = buf[2*k], im = buf[2*k+1];
    const p  = re*re + im*im + 1e-12;
    out[i] = 10 * Math.log10(p / N);
  }
  return out;
}
