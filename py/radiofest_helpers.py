"""
Готовые помощники для участников: демодуляция OOK и расчёт пеленга.
"""
import numpy as np

LAMBDA  = 0.1153   # м, при f = 2.6 ГГц
ANT_D   = 0.05     # м, расстояние между антеннами в паре
BIT_S   = 250e-6   # длительность бита, с
PREAMBLE = 0x7E    # '~'


def _decode_to_packets(env, fs):
    """Возвращает список (code:str, start_sample, end_sample) для всех найденных
    8-байтовых пакетов с преамбулой '~'. Перебирает все четверть-битовые сдвиги
    и все битовые сдвиги внутри байта."""
    if env.max() - env.min() < 1e-3:
        return []
    spb = int(round(fs * BIT_S))
    if spb < 4 or len(env) < 64*spb:
        return []
    thr = (env.max() + env.min()) / 2
    packets = []
    for sub in (0, spb//4, spb//2, 3*spb//4):
        n = ((len(env) - sub) // spb) * spb
        if n <= 0:
            continue
        bits = (env[sub:sub+n].reshape(-1, spb).mean(1) > thr).astype(np.uint8)
        for bit_shift in range(8):
            tail = bits[bit_shift:]
            n8 = (len(tail) // 8) * 8
            if n8 < 64:
                continue
            bytes_ = np.packbits(tail[:n8])
            idx = np.where(bytes_ == PREAMBLE)[0]
            for p in idx:
                if p + 8 <= len(bytes_):
                    chunk = bytes_[p:p+8]
                    if np.all((chunk >= 32) & (chunk < 127)):
                        s = chunk.tobytes().decode("ascii")
                        # позиция в семплах: sub + bit_shift + p*8 битов
                        bit_pos   = bit_shift + p*8
                        start     = sub + bit_pos * spb
                        end       = start + 64*spb
                        packets.append((s, start, end))
    return packets


def demod_ook(iq, fs=200_000.0):
    """Возвращает первый найденный 8-символьный код (или '?')."""
    iq  = np.asarray(iq, np.complex64)
    pkts = _decode_to_packets(np.abs(iq), fs)
    return pkts[0][0] if pkts else "?"


def find_packet(iq, code, fs=200_000.0):
    """Ищет конкретный код, возвращает (start, end) в семплах или None."""
    iq  = np.asarray(iq, np.complex64)
    for s, st, en in _decode_to_packets(np.abs(iq), fs):
        if s == code:
            return (st, en)
    return None


def est_phase(iq0, iq1, window=None):
    """Δφ = ∠( s1 · conj(s0) ).  Если задан window=(start,end) — считает только в нём,
    иначе по верхнему квантилю огибающей (отбираем «несущую активна»)."""
    iq0 = np.asarray(iq0, np.complex64)
    iq1 = np.asarray(iq1, np.complex64)
    if window is not None:
        s, e = int(window[0]), int(min(len(iq0), window[1]))
        a, b = iq0[s:e], iq1[s:e]
        env  = np.abs(a)
        if env.max() < 1e-6:
            return 0.0
        thr  = env.max() * 0.5
        m    = env > thr
        sel  = (b * np.conj(a))[m]
        if len(sel) == 0:
            return 0.0
        return np.angle(np.sum(sel * np.abs(sel)))
    e0  = np.abs(iq0); e1 = np.abs(iq1)
    e   = np.minimum(e0, e1)
    if e.max() < 1e-6:
        return 0.0
    thr = np.quantile(e, 0.85)
    mask = e > thr
    if mask.sum() < 8:
        mask = e > e.max()*0.5
    sel = (iq1 * np.conj(iq0))[mask]
    if len(sel) == 0:
        return 0.0
    return np.angle(np.sum(sel * np.abs(sel)))


def angle_from_phase(dphi):
    """Δφ → угол θ (радианы), формула фазового интерферометра."""
    sin_th = dphi / (2*np.pi*ANT_D/LAMBDA)
    return np.arcsin(np.clip(sin_th, -1.0, 1.0))


def class_from_angle(theta_deg):
    """θ → один из {0,1,2}: левая/центр/правая колонка (или строка)."""
    if theta_deg < -8: return 0
    if theta_deg >  8: return 2
    return 1


def target_number(dphi_x, dphi_y):
    """Δφ_x (азимут) + Δφ_y (угол места) → № мишени 1..9."""
    th_x = np.degrees(angle_from_phase(dphi_x))
    th_y = np.degrees(angle_from_phase(dphi_y))
    col  = class_from_angle(th_x)            # 0 left, 2 right
    # верхняя строка = +y → положительный Δφ_y → class=2 → row=0
    row  = 2 - class_from_angle(th_y)
    return row * 3 + col + 1


def judge_code():
    """Прочитать актуальный код судьи из глобального симулятора."""
    try:
        from js import simulator
        return str(simulator.judgeCode)
    except Exception:
        return "?"
