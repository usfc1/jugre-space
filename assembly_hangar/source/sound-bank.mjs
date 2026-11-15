const tau = 2 * Math.PI;
const rate = 24000;
const wave = (hz, t) => Math.sin(tau * hz * t);
const decay = (t, seconds) => Math.exp(-Math.max(t, 0) / seconds);
const hit = (t, at, seconds) => t < at ? 0 : decay(t - at, seconds);

function render(context, duration, sample, loop = false) {
  const buffer = context.createBuffer(1, Math.round(duration * rate), rate);
  const data = buffer.getChannelData(0);
  let seed = 314159265;
  let bass = 0;
  let mid = 0;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    bass += .027 * (noise - bass);
    mid += .21 * (noise - mid);
    const t = i / rate;
    const edge = Math.min(1, t / (loop ? .035 : .004), (duration - t) / (loop ? .035 : .025));
    data[i] = Math.tanh(sample(t, noise, bass, mid) * edge);
  }
  return buffer;
}

export function makeSoundBank(context) {
  const s = (length, fn, loop) => render(context, length, fn, loop);
  return {
    engine: s(3.7, (t, n, b, m) => (3.7 * b + .42 * m + .19 * wave(44, t) + .07 * wave(67, t))
      * (.77 + .18 * wave(5.1, t) + .08 * wave(12.3, t)), true),
    airflow: s(3.13, (t, n, b, m) => (1.9 * b + .88 * m + .07 * n) * (.76 + .2 * wave(4.3, t)), true),
    cabin: s(4.1, (t, n, b, m) => .11 * wave(50, t) + .053 * wave(97, t) + .085 * m + .18 * b, true),
    spin: s(1.27, (t, n, b, m) => (0.30 * wave(170 + t * 120, t) + .95 * m) * Math.sin(Math.PI * t / 1.27)),
    launch: s(2.35, (t, n, b, m) => (3.9 * b + .81 * m + .47 * wave(38, t)) * decay(t, .68)
      + (n + 1.3 * m) * (hit(t, .015, .09) + .55 * hit(t, .084, .11)) * .48),
    ignition: s(.78, (t, n, b, m) => (2.65 * b + .76 * m + .23 * wave(58, t)) * decay(t, .18)),
    stage: s(.69, (t, n, b, m) => (2.55 * b + .41 * wave(112, t)) * decay(t, .085)
      + .42 * (n + wave(590, t)) * hit(t, .078, .07)),
    mechanism: s(.57, (t, n, b, m) => .65 * (m + .18 * wave(265, t)) * hit(t, .08, .12)
      + (.55 * wave(154, t) + .19 * n) * (hit(t, .017, .042) + hit(t, .315, .057))),
    docking: s(.89, (t, n, b, m) => (1.7 * b + .32 * wave(90, t)) * decay(t, .10)
      + (.38 * wave(495, t) + .55 * m) * (hit(t, .21, .06) + hit(t, .32, .05) + .74 * hit(t, .48, .063))),
    touchdown: s(1.07, (t, n, b, m) => (2.35 * b + .56 * wave(52, t)) * decay(t, .14) + .59 * m * hit(t, .13, .23)),
    splash: s(1.39, (t, n, b, m) => (1.1 * b + .82 * m + .29 * n) * Math.min(1, t / .09) * decay(t, .36)),
    impact: s(.93, (t, n, b, m) => (2.8 * b + .42 * wave(75, t)) * decay(t, .14)
      + .53 * (m + n) * (hit(t, .045, .08) + .48 * hit(t, .20, .09))),
    fracture: s(.92, (t, n, b, m) => (.7 * n + .41 * wave(764, t)) * (.56 * hit(t, .035, .05) + .42 * hit(t, .13, .08)
      + .3 * hit(t, .22, .07) + .24 * hit(t, .34, .09))),
    blast: s(2.25, (t, n, b, m) => (4.3 * b + .70 * m + .57 * wave(31, t)) * decay(t, .53)
      + .82 * n * (hit(t, .015, .06) + .38 * hit(t, .18, .14))),
    suit: s(.29, (t, n, b, m) => (.62 * m + .18 * wave(190, t)) * (hit(t, .013, .038) + .63 * hit(t, .11, .046))),
    step: s(.36, (t, n, b, m) => (1.45 * b + .43 * wave(76, t)) * hit(t, .01, .073) + .53 * m * hit(t, .08, .081)),
    radio: s(.12, (t, n, b, m) => (.55 * n + .28 * m) * decay(t, .036)),
    alert: s(.68, (t) => (.52 * wave(935, t) + .17 * wave(1247, t)) * (decay(t, .095) + hit(t, .29, .096))),
    click: s(.064, (t, n) => (.37 * wave(1130, t) + .26 * n) * decay(t, .015)),
    switch: s(.11, (t, n) => (.35 * wave(675, t) + .22 * n) * (decay(t, .017) + .46 * hit(t, .033, .02))),
    music: s(16, (t) => {
      const pulse = .50 - .21 * wave(1 / 16, t);
      const root = wave(55, t) * .21 + wave(82.375, t) * .12 + wave(110, t) * .064;
      const tones = wave(130.8125, t) * .087 + wave(164.8125, t) * .051 + wave(220, t) * .029;
      return (root + tones * (.52 + .24 * wave(1 / 8, t))) * pulse;
    }, true),
  };
}
