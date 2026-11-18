"""Original synthesized score + sound design for the JUGRE trailer.
Everything is generated here (no third-party music); voice lines come from the game's
own radio recordings (assets/audio/radio, created for JUGRE with Kokoro-82M, Apache-2.0)."""
import json, os, subprocess, sys
import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, fftconvolve

SR = 48000
BASE = sys.argv[1] if len(sys.argv) > 1 else '.'
CUES = json.load(open(f'{BASE}/cues.json'))
RADIO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'assembly_hangar', 'assets', 'audio', 'radio')
DUR = CUES['duration']
N = int(DUR * SR) + SR * 4
rng = np.random.default_rng(7)
BPM = 120
BEAT = 60 / BPM
S16 = BEAT / 4

music = np.zeros((N, 2)); drums = np.zeros((N, 2)); sfx = np.zeros((N, 2)); voice = np.zeros((N, 2)); send = np.zeros((N, 2))

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
def tt(d): return np.arange(int(d * SR)) / SR
def sos(kind, f, order=2):
    nyq = SR / 2
    if kind == 'band': return butter(order, [f[0] / nyq, min(f[1] / nyq, .99)], btype='band', output='sos')
    return butter(order, min(f / nyq, .99), btype=kind, output='sos')
def filt(x, kind, f, order=2): return sosfilt(sos(kind, f, order), x, axis=0)
def env(n, a, r, curve=3.0):
    e = np.ones(n); na = max(1, int(a * SR)); nr = max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na) ** 1.5
    if nr < n: e[-nr:] *= np.linspace(1, 0, nr) ** curve
    return e
def expdec(n, tau): return np.exp(-np.arange(n) / (tau * SR))
def put(buf, sig, t0, gain=1.0, pan=0.0, rev=0.0):
    i0 = int(t0 * SR)
    if i0 >= len(buf): return
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.414, sig * r * 1.414], 1)
    n = min(len(sig), len(buf) - i0)
    if i0 < 0: sig = sig[-i0:]; n = min(len(sig), len(buf)); i0 = 0
    buf[i0:i0 + n] += sig[:n] * gain
    if rev: send[i0:i0 + n] += sig[:n] * gain * rev
def saw(f, d, phase=0.0):
    t = tt(d); ph = (f * t + phase) % 1.0; return 2 * ph - 1
def supersaw(f, d, voices=7, det=0.012, seed=0):
    r = np.random.default_rng(seed); out = np.zeros((int(d * SR), 2))
    for k in range(voices):
        dt = (k - (voices - 1) / 2) / ((voices - 1) / 2) * det
        s = saw(f * (1 + dt), d, r.random())
        p = (k / (voices - 1)) * 2 - 1
        out[:, 0] += s * (1 - p) / 2; out[:, 1] += s * (1 + p) / 2
    return out / voices * 2
def sweep_lp(x, f0, f1, chunk=1024, curve=2.0):
    """Time-varying 2-pole lowpass (stateful, chunked)."""
    y = np.zeros_like(x); n = len(x); zi = None
    for i in range(0, n, chunk):
        p = (i / max(1, n - 1)) ** curve
        fc = f0 * (f1 / f0) ** p if f0 > 0 and f1 > 0 else f0 + (f1 - f0) * p
        s = sos('low', max(30, fc))
        seg = x[i:i + chunk]
        if zi is None: zi = np.zeros((s.shape[0], 2, x.shape[1])) if x.ndim == 2 else np.zeros((s.shape[0], 2))
        seg_y, zi = sosfilt(s, seg, axis=0, zi=zi)
        y[i:i + chunk] = seg_y
    return y

# ---------------- instruments ----------------
CH = {  # chord tones (MIDI)
    'Am': dict(root=45, pad=[57, 60, 64, 71], arp=[69, 72, 76, 79, 81, 79, 76, 72]),
    'F':  dict(root=41, pad=[53, 57, 60, 67], arp=[65, 69, 72, 77, 79, 77, 72, 69]),
    'C':  dict(root=48, pad=[55, 60, 64, 67], arp=[67, 72, 76, 79, 84, 79, 76, 72]),
    'G':  dict(root=43, pad=[55, 59, 62, 67], arp=[67, 71, 74, 79, 83, 79, 74, 71]),
    'Em': dict(root=40, pad=[55, 59, 64, 71], arp=[64, 67, 71, 76, 79, 76, 71, 67]),
    'Dm': dict(root=38, pad=[57, 62, 65, 69], arp=[62, 65, 69, 74, 77, 74, 69, 65]),
}
PROG = ['Am', 'F', 'C', 'G']
def chord_at(t, prog=PROG): return prog[int(t // 2.0) % len(prog)]

def pad(chord, t0, d, gain=.12, f0=600, f1=2400, a=.6, r=.8, seed=1):
    out = np.zeros((int(d * SR), 2))
    for i, n in enumerate(CH[chord]['pad']):
        out += supersaw(midi(n), d, 5, .009, seed + i)
    out = sweep_lp(out, f0, f1)
    out *= env(len(out), a, r, 1.5)[:, None]
    put(music, out, t0, gain, rev=.55)

def pluck(n, t0, gain=.08, dec=.22, bright=3500, pan=0.0):
    d = dec * 4; f = midi(n)
    s = .6 * saw(f, d) + .4 * np.sign(np.sin(2 * np.pi * f * tt(d)))
    s = filt(s, 'low', bright) * expdec(len(s), dec)
    s *= env(len(s), .002, .05)
    put(music, s, t0, gain, pan, rev=.35)

def bass(n, t0, d, gain=.22):
    f = midi(n); s = np.sin(2 * np.pi * f * tt(d)) + .35 * saw(f, d)
    s = filt(s, 'low', 380) * env(len(s), .005, .06) * expdec(len(s), d * .9)
    put(music, np.tanh(s * 1.6), t0, gain)

SUBG = .32
def sub(n, t0, d, gain=.25, a=1.0, r=1.5):
    f = midi(n); x = tt(d); s = (np.sin(2 * np.pi * f * x) + .18 * np.sin(2 * np.pi * f * 2 * x)) * env(int(d * SR), a, r, 1.2)
    put(music, s, t0, gain * SUBG)

def glass(n, t0, gain=.05, pan=0.0):
    d = 3.0; f = midi(n); t = tt(d)
    s = (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.01 * t) + .12 * np.sin(2 * np.pi * f * 3.98 * t)) * expdec(len(t), .9)
    s *= env(len(s), .004, .3)
    put(music, s, t0, gain, pan, rev=.9)

def kick(t0, gain=.55, tone=48):
    d = .5; t = tt(d); f = tone + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), .16)
    click = filt(rng.standard_normal(len(t)), 'high', 2000) * expdec(len(t), .004) * .3
    put(drums, np.tanh((s + click) * 1.8), t0, gain)

def snare(t0, gain=.3):
    d = .4; t = tt(d)
    nz = filt(rng.standard_normal(len(t)), 'band', (900, 7000)) * expdec(len(t), .09)
    tone = np.sin(2 * np.pi * 190 * t) * expdec(len(t), .05)
    put(drums, nz + .6 * tone, t0, gain, rev=.25)

def hat(t0, gain=.06, open_=False, pan=.2):
    d = .3; nz = filt(rng.standard_normal(int(d * SR)), 'high', 7000) * expdec(int(d * SR), .09 if open_ else .022)
    put(drums, nz, t0, gain, pan)

def tom(t0, gain=.45, f0=90, pan=0.0):
    d = 1.4; t = tt(d); f = f0 + 70 * np.exp(-t * 12)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * expdec(len(t), .35)
    nz = filt(rng.standard_normal(len(t)), 'band', (200, 1500)) * expdec(len(t), .03) * .5
    put(drums, np.tanh((s + nz) * 1.4), t0, gain, pan, rev=.5)

def braam(t0, chord='Am', gain=.42, d=4.5):
    root = CH[chord]['root'] - 12
    out = np.zeros((int(d * SR), 2))
    for k, n in enumerate([root, root + 12, root + 19, root + 24]):
        out += supersaw(midi(n), d, 5, .006, 50 + k) * (1.0 if k < 2 else .6)
    out = sweep_lp(out, 2600, 260, curve=.6)
    out = np.tanh(out * 2.2) * (env(len(out), .015, 1.8, 1.4) * (.35 + .65 * expdec(len(out), 1.1)))[:, None]
    put(music, out, t0, gain, rev=.6)
    sub(CH[chord]['root'] - 12, t0, d, .5, .01, 2.5)

def impact(t0, gain=.6):
    d = 4.0; t = tt(d)
    drop = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 1.6) + 28) / SR) * expdec(len(t), 1.0)
    nz = filt(rng.standard_normal(len(t)), 'low', 2500) * expdec(len(t), .25)
    put(sfx, np.tanh((drop * 1.4 + nz * .7) * 1.3), t0, gain, rev=.5)

def soft_hit(t0, gain=.25):
    tom(t0, gain, 70)
    d = .9; nz = filt(rng.standard_normal(int(d * SR)), 'band', (150, 900)) * expdec(int(d * SR), .12)
    put(sfx, nz, t0, gain * .4, rev=.6)

def whoosh(t0, gain=.22, d=.9):
    n = int(d * SR); nz = rng.standard_normal((n, 2))
    y = np.zeros_like(nz); zi = None; chunk = 512
    for i in range(0, n, chunk):
        p = i / n; fc = 300 * (6000 / 300) ** (np.sin(np.pi * p))
        s = sos('band', (fc * .7, fc * 1.4))
        if zi is None: zi = np.zeros((s.shape[0], 2, 2))
        y[i:i + chunk], zi = sosfilt(s, nz[i:i + chunk], axis=0, zi=zi)
    y *= (np.sin(np.pi * np.linspace(0, 1, n)) ** 2)[:, None]
    put(sfx, y, t0 - d * .55, gain, rev=.3)

def riser(t0, t1, gain=.2):
    d = t1 - t0; n = int(d * SR); t = tt(d); p = t / d
    nz = rng.standard_normal((n, 2))
    y = np.zeros_like(nz); zi = None; chunk = 512
    for i in range(0, n, chunk):
        fc = 400 * (9000 / 400) ** (i / n)
        s = sos('band', (fc * .6, fc * 1.5))
        if zi is None: zi = np.zeros((s.shape[0], 2, 2))
        y[i:i + chunk], zi = sosfilt(s, nz[i:i + chunk], axis=0, zi=zi)
    tone = np.zeros(n)
    for k in range(3):  # Shepard-like rising sines
        f = 110 * 2 ** k * 2 ** (p * 1.0)
        tone += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * ((p + k / 3) % 1)) ** 2
    amp = (p ** 2.2)
    put(sfx, y * amp[:, None] * .9, t0, gain, rev=.4)
    put(music, tone * amp * .35, t0, gain, rev=.4)

def reverse_swell(t1, d=2.0, gain=.25, chord='Am'):
    out = np.zeros((int(d * SR), 2))
    for i, n in enumerate(CH[chord]['pad']): out += supersaw(midi(n), d, 3, .01, 90 + i)
    out = filt(out, 'low', 3000)
    out *= (np.linspace(0, 1, len(out)) ** 3)[:, None]
    put(music, out, t1 - d, gain, rev=.6)

def tick(t0, gain=.12, accent=False):
    d = .05; t = tt(d); s = np.sin(2 * np.pi * (2200 if accent else 1600) * t) * expdec(len(t), .006)
    nz = filt(rng.standard_normal(len(t)), 'high', 3000) * expdec(len(t), .003)
    put(sfx, s + nz * .5, t0, gain, .1)

def heartbeat(t0, gain=.5):
    kick(t0, gain * .9, 42); kick(t0 + .22, gain * .55, 40)

def rumble(t0, t1, peak=39.0, gain=.7):
    d = t1 - t0; n = int(d * SR); t = tt(d) + t0
    w = rng.standard_normal((n, 2))
    brown = np.cumsum(w, axis=0); brown -= filt(brown, 'low', 8, 1); brown /= np.abs(brown).max() + 1e-9
    roar = filt(rng.standard_normal((n, 2)), 'band', (180, 1400)) * .35
    crack = (rng.random((n, 2)) < .0009) * rng.standard_normal((n, 2)) * 6
    crack = filt(crack, 'band', (300, 4000))
    body = filt(brown, 'low', 220) * 2.2 + roar + crack * .25
    mod = 1 + .25 * filt(rng.standard_normal(n), 'low', 6) * 8
    e = np.interp(t, [t0, t0 + .4, peak - .3, peak, peak + 4, t1 - 4, t1], [0, .3, .65, 1, .9, .35, 0])
    put(sfx, np.tanh(body * mod[:, None] * 1.5) * e[:, None], t0, gain)

def clank(t0, gain=.35):
    d = 1.6; t = tt(d); s = np.zeros(len(t))
    for f, a, tau in [(312, 1, .5), (731, .7, .35), (1187, .5, .25), (1873, .35, .2), (2650, .2, .12)]:
        s += a * np.sin(2 * np.pi * f * t) * expdec(len(t), tau)
    nz = filt(rng.standard_normal(len(t)), 'band', (500, 5000)) * expdec(len(t), .01)
    put(sfx, (s * .5 + nz) * env(len(t), .001, .2), t0, gain, -.2, rev=.4)

def splash(t0, gain=.5):
    d = 2.5; n = int(d * SR)
    nz = filt(rng.standard_normal((n, 2)), 'band', (250, 6000)) * expdec(n, .45)[:, None]
    low = filt(rng.standard_normal((n, 2)), 'low', 200) * expdec(n, .3)[:, None] * 2
    put(sfx, (nz + low) * env(n, .01, .5)[:, None], t0, gain, rev=.3)

def debris(t0, d=2.5, gain=.25):
    n = int(d * SR); x = (rng.random((n, 2)) < .002) * rng.standard_normal((n, 2))
    x = filt(x, 'band', (800, 6000)) * 8 * np.linspace(1, 0, n)[:, None] ** 2
    put(sfx, x, t0, gain, rev=.4)

# ---------------- arrangement ----------------
# INTRO 0-12: drone + airy pad + glass
sub(33, 0.0, 12.5, .3, 3.0, 2.0); sub(40, 2.0, 10.5, .15, 3.0, 2.0)
pad('Am', 1.0, 7.0, .03, 400, 1400, a=3.0, r=2.0, seed=3)
pad('F', 8.0, 4.0, .04, 600, 1800, a=.8, r=1.0, seed=4)
for t0, n, p in [(2.5, 81, -.4), (4.0, 76, .4), (5.5, 83, -.2), (7.0, 79, .3), (8.5, 84, -.3), (10.0, 88, .2)]: glass(n, t0, .05, p)
for k in range(8, 12):  # pluck pre-roll at Kennedy
    for j in range(8):
        tt0 = k + j * .125
        pluck(CH[chord_at(tt0)]['arp'][j % 8], tt0, .025 + .01 * (k - 8), .18, 2500, (-.3, .3)[j % 2])
reverse_swell(12.0, 2.5, .2)

# BUILD 12-30
for bar in range(12, 30, 2):
    c = chord_at(bar)
    pad(c, bar, 2.05, .075 if bar < 22 else .09, 700, 2600, a=.05, r=.3, seed=bar)
    sub(CH[c]['root'] - 12, bar, 2.0, .16, .02, .3)
    for j in range(16):
        t0 = bar + j * S16
        pluck(CH[c]['arp'][j % 8], t0, .07 + .03 * ((bar - 12) / 18), .16, 2800 + 2500 * ((bar - 12) / 18), (-.35, .35)[j % 2])
for b in np.arange(14.0, 30.0, BEAT): kick(b, .26 if b < 22 else .38)
for b in np.arange(18.0, 30.0, BEAT / 2): hat(b, .05 if (b * 2) % 2 else .035)
for b in np.arange(22.0, 30.0, BEAT): snare(b + BEAT, .16) if int(b * 2) % 4 == 0 else None
for b in np.arange(22.0, 28.0, BEAT / 2): bass(CH[chord_at(b)]['root'], b, .24, .2)
for b in [28.0, 28.4, 28.8, 29.2, 29.6]: tom(b, .42, 95 - (b - 28) * 18)
for b in np.arange(29.0, 30.0, BEAT / 4): snare(b, .05 + .12 * (b - 29))

# LAUNCH build-up 30-39
braam(30.0, 'Am', .32, 3.0)
pad('Am', 30.0, 7.3, .1, 500, 1600, a=1.5, r=.2, seed=31)
for b in np.arange(32.0, 37.25, BEAT / 2): bass(33, b, .2, .12)
for n_ in [69, 70]: sub(n_, 31.0, 6.4, .018, 2.0, .3)  # tension cluster
for i, b in enumerate(np.arange(32.0, 37.25, BEAT)): tick(b, .14, accent=(i % 2 == 0))
for b in [32.3, 34.5, 35.5, 36.5]: heartbeat(b, .55)
# silence gap 37.25-37.3 then ignition rumble builds to liftoff
braam(39.0, 'Am', .55, 5.0); impact(39.0, .75)

# ASCENT 39-55
ASC = ['Am', 'F', 'C', 'G']
for bar in range(39, 51, 2):
    c = ASC[((bar - 39) // 2) % 4]
    pad(c, bar, 2.05, .085, 900, 3200, a=.03, r=.3, seed=100 + bar)
    for j in range(8): bass(CH[c]['root'], bar + j * BEAT / 2, .23, .24)
    for j in range(16): pluck(CH[c]['arp'][j % 8] + 12 * (j % 2 == 1 and bar > 42), bar + j * S16, .04, .14, 4500, (-.4, .4)[j % 2])
for b in np.arange(40.0, 51.0, BEAT): kick(b, .55)
for b in np.arange(40.5, 51.0, BEAT * 2): snare(b, .32)
for b in np.arange(40.0, 51.0, BEAT / 2): hat(b, .05)
for b in [46.0, 46.25, 46.5, 46.75]: tom(b, .5, 110 - (b - 46) * 40)
braam(47.0, 'F', .38, 3.0); impact(47.0, .45)
# orbit: airy
pad('C', 51.0, 2.0, .07, 900, 2000, a=.3, r=.4, seed=151); pad('G', 53.0, 2.2, .07, 900, 2000, a=.1, r=.6, seed=153)
sub(36, 51.0, 4.0, .18, .2, 1.0)
for t0, n, p in [(51.2, 79, -.3), (52.2, 84, .3), (53.2, 86, -.2), (54.0, 91, .2)]: glass(n, t0, .045, p)
reverse_swell(55.0, 2.0, .22, 'Am')

# EXPLORE 55-85
braam(55.0, 'Am', .34, 3.0)
EXP = ['F', 'G', 'Am', 'Em']
for bar in range(57, 63, 2):
    c = EXP[((bar - 57) // 2) % 4]
    pad(c, bar, 2.05, .08, 700, 2200, a=.4, r=.4, seed=200 + bar)
    for j in range(8): glass(CH[c]['arp'][j], bar + j * .25, .022, (-.5, .5)[j % 2])
sub(41, 57.0, 6.0, .16, .5, .5)
for bar in range(63, 85, 2):
    c = EXP[((bar - 63) // 2) % 4]
    k = (bar - 63) / 22
    pad(c, bar, 2.05, .07 + .03 * k, 800, 2600 + 1800 * k, a=.05, r=.3, seed=300 + bar)
    sub(CH[c]['root'] - 12, bar, 2.0, .15, .02, .3)
    for j in range(16): pluck(CH[c]['arp'][j % 8], bar + j * S16, .035 + .02 * k, .15, 3000 + 3000 * k, (-.35, .35)[j % 2])
    for j in range(8): bass(CH[c]['root'], bar + j * BEAT / 2, .23, .14 + .1 * k)
for b in np.arange(63.0, 85.0, BEAT): kick(b, .34 + .2 * (b - 63) / 22)
for b in np.arange(67.0, 85.0, BEAT / 2): hat(b, .045)
for b in np.arange(71.5, 85.0, BEAT * 2): snare(b, .2 + .1 * (b - 71) / 14)
for b in [73.0, 73.25, 73.5, 73.75]: tom(b, .42, 100 - (b - 73) * 30)
impact(76.0, .7); braam(76.0, 'Am', .3, 2.5); debris(76.1, 3.0, .3)
clank(80.0, .4)
splash(CUES['splashAt'], .55)

# MONTAGE 85-89
for bar in [85, 87]:
    c = ['F', 'G'][(bar - 85) // 2]
    pad(c, bar, 2.05, .1, 1200, 4500, a=.02, r=.2, seed=400 + bar)
    for j in range(8): bass(CH[c]['root'], bar + j * BEAT / 2, .23, .26)
    for j in range(16): pluck(CH[c]['arp'][j % 8] + 12, bar + j * S16, .045, .12, 6000, (-.4, .4)[j % 2])
for b in np.arange(85.0, 89.0, BEAT / 2): kick(b, .5 if (b * 2) % 2 == 0 else .3)
for b in np.arange(85.5, 89.0, BEAT): snare(b, .3)
for b in np.arange(88.0, 89.0, BEAT / 8): snare(b, .08 + .25 * (b - 88))

# TECH WALL 89-94
braam(89.0, 'Am', .42, 4.0); impact(89.0, .5)
pad('Am', 89.0, 5.0, .08, 800, 2800, a=.05, r=.5, seed=500)
for j in range(int(5 / S16) - 4):
    t0 = 89.5 + j * S16
    pluck([81, 84, 88, 91, 93, 91, 88, 84][j % 8], t0, .03, .12, 5000, (-.5, .5)[j % 2])
for b in np.arange(89.5, 93.5, BEAT): kick(b, .28, 44)

# LOGO 94-101
braam(94.0, 'Am', .5, 6.5); impact(94.0, .8)
pad('Am', 94.0, 7.0, .05, 1800, 500, a=.02, r=3.5, seed=600)
sub(33, 94.0, 7.0, .3, .02, 4.0)
for t0, n, p in [(95.0, 81, -.3), (96.0, 88, .3), (97.0, 84, -.2), (98.0, 93, .2)]: glass(n, t0, .045, p)

# ---------------- sound design from cues ----------------
for t in CUES['hits']:
    if t not in (39.0, 47.0, 76.0, 89.0, 94.0, 30.0, 55.0): impact(t, .5)
for t in CUES['softHits']: soft_hit(t, .18)
for t in CUES['whooshes']: whoosh(t, .2)
for a, b in CUES['risers']: riser(a, b, .22 if b - a < 3 else .26)
rumble(CUES['rumble'][0], CUES['rumble'][1], 39.0, .85)
impact(12.0, .45)

# ---------------- voice (radio processing + quindar) ----------------
def load_mp3(name):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{RADIO}/{name}.mp3', '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)
def quindar(f, d=.22):
    t = tt(d); return np.sin(2 * np.pi * f * t) * env(len(t), .005, .01) * .18
duck = np.ones(N)
for v in CUES['voice']:
    x = load_mp3(v['clip'])
    x = x / (np.abs(x).max() + 1e-9) * .9
    x = filt(x, 'band', (280, 3600), 3)
    x = np.tanh(x * 2.2) / np.tanh(2.2)
    hiss = filt(rng.standard_normal(len(x) + int(.4 * SR)), 'band', (1500, 6000)) * .012
    big = v['clip'] in ('preflight', 'count_10', 'orbit', 'lunar_descent', 'success', 'probe_impact')
    t0 = v['at']
    if big: put(voice, quindar(2525), t0 - .3, 1.0)
    put(voice, hiss, t0 - .2, 1.0)
    put(voice, x, t0, .8 if v['clip'] != 'liftoff' else .95, rev=.06)
    if big: put(voice, quindar(2475), t0 + len(x) / SR + .05, 1.0)
    i0, i1 = int((t0 - .15) * SR), int((t0 + len(x) / SR + .2) * SR)
    duck[max(0, i0):i1] = np.minimum(duck[max(0, i0):i1], .5)
duck = filt(duck, 'low', 6, 1)

# ---------------- mix ----------------
ir_len = int(3.2 * SR); ir_t = np.arange(ir_len) / SR
ir = rng.standard_normal((ir_len, 2)) * np.exp(-ir_t / .75)[:, None]
ir = filt(ir, 'low', 6000); ir[:int(.02 * SR)] *= np.linspace(0, 1, int(.02 * SR))[:, None]
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1) * .55

bed = (music + drums * .9 + wet * .8)
mix = bed * (duck[:, None]) + sfx * .9 + voice * 1.05
mix = filt(mix, 'high', 32, 3)
peak = np.abs(mix).max(); mix = mix / peak * .89
# master fade
fade_out = int(DUR * SR); mix[fade_out:] = 0
f0 = int((DUR - 2.5) * SR); mix[f0:fade_out] *= np.linspace(1, 0, fade_out - f0)[:, None] ** 1.5
out = mix[:fade_out].astype(np.float32)
open(f'{BASE}/audio/mix_raw.f32', 'wb').write(out.tobytes())
print('peak', peak, 'samples', len(out))
if '--debug' in sys.argv:
    def r(b, a, z): seg = b[int(a * SR):int(z * SR)]; return 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
    for a, z in [(1, 6), (6, 11), (15, 20), (34, 36), (40, 44), (58, 60), (64, 70), (90, 92), (96.5, 98.5)]:
        print(f'{a}-{z}: music {r(music,a,z):.1f} drums {r(drums,a,z):.1f} sfx {r(sfx,a,z):.1f} voice {r(voice,a,z):.1f} wet {r(wet,a,z):.1f}')
