"""
SoapySDR — мок-библиотека для песочницы Радиофест-2025.

Полностью повторяет публичный API настоящей `SoapySDR` в части, нужной
участникам соревнований, но вместо обращения к железу читает I/Q-семплы
из единого «эфирного» симулятора, реализованного на JavaScript.

Особенность Pyodide: модуль `js` даёт доступ к глобальному
`window.simulator`, который и является источником семплов.
"""
from __future__ import annotations
import numpy as np

# Совпадает с реальной библиотекой
SOAPY_SDR_RX   = "RX"
SOAPY_SDR_TX   = "TX"
SOAPY_SDR_CF32 = "CF32"
SOAPY_SDR_CS16 = "CS16"


def _sim():
    # Импорт лениво — чтобы при запуске вне Pyodide (тесты) можно было замокать.
    try:
        from js import simulator  # noqa: F401
        return simulator
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "SoapySDR (мок) запускается только внутри браузерной "
            "песочницы Радиофест: нет доступа к JS-симулятору."
        ) from exc


def _to_np(jsbuf, n_complex):
    """Скопировать interleaved Float32 (2*N) из JS в np.complex64 длины N."""
    arr = np.asarray(jsbuf.to_py(), dtype=np.float32) \
        if hasattr(jsbuf, "to_py") else np.asarray(jsbuf, dtype=np.float32)
    arr = arr.reshape(-1, 2)
    return arr[:n_complex, 0] + 1j * arr[:n_complex, 1]


class _Stream:
    def __init__(self, dev, direction, fmt, channels):
        self.dev = dev
        self.direction = direction
        self.fmt = fmt
        self.channels = list(channels)
        self.mtu = 4096
        self.active = False
        self.t_cursor = 0.0    # модельное время, секунды


class Device:
    """Мок устройства LimeSDR.  args может быть строкой 'lime' или dict."""
    def __init__(self, args="lime"):
        if isinstance(args, str):
            args = {"driver": args}
        self.args = dict(args) if args else {"driver": "lime"}
        self.index = int(self.args.get("index", 0))   # 0 = SDR-X, 1 = SDR-Y
        self._fs = {0: 200_000.0}
        self._fc = {0: 2.6e9}
        self._gain = {0: 20.0}
        self._ant = {0: "LNAH"}

    def __repr__(self):
        return f"<SoapySDR.Device(mock) lime index={self.index}>"

    # --- настройки ---
    def setSampleRate(self, _dir, ch, rate):
        self._fs[ch] = float(rate)
        # Транслируем в общий симулятор (одна частота на стенд)
        _sim().sampleRate = float(rate)
    def getSampleRate(self, _dir, ch):           return self._fs.get(ch, 200e3)
    def setFrequency(self, _dir, ch, freq):      self._fc[ch]   = float(freq)
    def getFrequency(self, _dir, ch):            return self._fc.get(ch, 2.6e9)
    def setGain(self, _dir, ch, *args):
        # перегруженная сигнатура: setGain(dir, ch, value)
        # либо setGain(dir, ch, "LNA"|"PGA"|"TIA", value)
        if len(args) == 1:
            self._gain[ch] = float(args[0])
        else:
            self._gain[ch] = float(args[1])
        try: _sim().gainDb = float(self._gain[ch])
        except: pass
    def getGain(self, _dir, ch, *args):          return self._gain.get(ch, 20.0)
    def setAntenna(self, _dir, ch, name):        self._ant[ch] = str(name)
    def getAntenna(self, _dir, ch):              return self._ant.get(ch, "LNAH")
    def setIQBalanceMode(self,*a,**k): pass
    def setDCOffsetMode(self,*a,**k): pass

    # --- стрим ---
    def setupStream(self, direction, fmt, channels):
        if fmt != SOAPY_SDR_CF32:
            raise ValueError("мок поддерживает только SOAPY_SDR_CF32")
        return _Stream(self, direction, fmt, list(channels))
    def activateStream(self, stream):
        # Синхронизируем стартовое время стрима с актуальным «эфирным временем»,
        # одинаковым для всех устройств: «sticky» курсор симулятора.
        sim = _sim()
        try:
            cur = float(sim.pyCursor)
        except Exception:
            cur = 0.0
        # Если симулятор давно не «нарезался» — стартуем «здесь и сейчас»
        try:
            from js import performance
            now = performance.now() / 1000.0 - float(sim.tStart)
        except Exception:
            now = cur
        # Берём более позднее из двух (чтобы новые стримы не начинали в прошлом)
        stream.t_cursor = max(cur, now)
        sim.pyCursor    = stream.t_cursor
        stream.active   = True
    def deactivateStream(self, stream):  stream.active = False
    def closeStream(self, stream):       stream.active = False
    def getStreamMTU(self, stream):      return stream.mtu

    def readStream(self, stream, buffers, num_samples, timeoutUs=100_000):
        """
        Читает num_samples в каждый из буферов buffers[i] (по одной антенне).
        Все каналы одного стрима — с одного «модельного времени». Курсор стрима
        продвигается на N/fs.
        """
        sim = _sim()
        fc  = self._fc.get(0, 2.6e9)
        N   = int(num_samples)

        # Заморозить курсор симулятора на t_cursor этого стрима, чтобы каналы
        # читались синхронно
        sim.pyCursor = stream.t_cursor
        for i, ch in enumerate(stream.channels):
            sim.pyCursor = stream.t_cursor
            jsbuf = sim.generateSamples(self.index, int(ch), N, float(fc), "py")
            data  = _to_np(jsbuf, N)
            buffers[i][:N] = data.astype(np.complex64)
        # Продвинули модельное время этого стрима ровно на N/fs
        stream.t_cursor += N / float(sim.sampleRate)
        sim.pyCursor    = stream.t_cursor

        class _Res: pass
        r = _Res(); r.ret = N; r.flags = 0; r.timeNs = 0
        return r

    # передатчик в этом моке только заглушка — на стенде передавать запрещено.
    def writeStream(self, *a, **k):
        raise PermissionError("на этом стенде передача в эфир запрещена регламентом")


# Удобные алиасы (соответствуют упоминаниям в документации турнира)
def Device_enumerate(*a, **k):
    return [{"driver": "lime", "index": "0"}, {"driver": "lime", "index": "1"}]
