// Builds comp/edit.js from the shot list + cues.json.
const fs = require('fs');
const cues = JSON.parse(fs.readFileSync('cues.json', 'utf8'));
const FPS = 30;
const frames = name => { try { return fs.readdirSync(`clips/${name}`).filter(f => f.endsWith('.jpg')).length; } catch { return 0; } };
const C = (name, start, end, o = {}) => ({ src: `../clips/${name}`, frames: frames(name), start, end, in: 0, zoom: [1.0, 1.04], ...o });
const cyan = s => `<span style="color:#8ce9ff">${s}</span>`;

const clips = [
  C('earth', 1.0, 8.0, { in: 20, fadeIn: 1.6, zoom: [1.0, 1.07], pan: [[400, 0], [360, 0]], grade: { b: 1.0, c: 1.1, s: 1.12 } }),
  C('kennedy', 8.0, 12.0, { in: 20, zoom: [1.02, 1.07] }),
  C('hangar', 12.0, 16.4, { in: 0, speed: 1.0, zoom: [1.0, 1.05] }),
  C('build', 16.4, 20.2, { in: 8, speed: 1.55, zoom: [1.0, 1.03] }),
  C('payload', 20.2, 23.6, { in: 14, zoom: [1.42, 1.52], pan: [[70, -150], [60, -165]] }),
  C('planner', 23.6, 25.6, { in: 6, speed: 1.9, zoom: [1.12, 1.2], pan: [[20, 10], [-30, 0]] }),
  C('si', 25.6, 28.0, { in: 10, speed: 2.3, zoom: [1.24, 1.32], pan: [[0, 40], [0, 10]] }),
  C('fleet_0', 28.0, 28.4, { in: 6, speed: 2.4, zoom: [1, 1] }),
  C('fleet_1', 28.4, 28.8, { in: 6, speed: 2.4, zoom: [1, 1] }),
  C('fleet_2', 28.8, 29.2, { in: 6, speed: 2.4, zoom: [1, 1] }),
  C('fleet_4', 29.2, 29.6, { in: 6, speed: 2.4, zoom: [1, 1] }),
  C('fleet_5', 29.6, 30.0, { in: 6, speed: 2.4, zoom: [1, 1.03] }),
  // LAUNCH (dusk take, game time g relative to T0; clip in = (g - window start) * 30)
  C('launch_far', 30.0, 34.5, { in: 0, speed: .79, zoom: [1.0, 1.05] }),
  C('launch_tower', 34.5, 35.5, { in: 45, zoom: [1.02, 1.05] }),
  C('launch_low', 35.5, 36.5, { in: 30, zoom: [1.0, 1.03] }),
  C('launch_engines', 36.5, 37.3, { in: 8, zoom: [1.04, 1.06] }),
  C('launch_deck', 37.3, 39.0, { in: 6, zoom: [1.0, 1.05], shake: 3 }),
  C('launch_engines2', 39.0, 41.2, { in: 12, zoom: [1.06, 1.0], shake: 7 }),
  C('launch_track', 41.2, 43.0, { in: 15, zoom: [1.0, 1.04], shake: 2 }),
  C('ascent_hud', 43.0, 47.0, { in: 10, zoom: [1, 1] }),
  C('staging', 47.0, 51.0, { in: 20, zoom: [1.5, 1.68], pan: [[0, 40], [0, 50]] }),
  C('orbit', 51.0, 55.0, { in: 20, zoom: [1.3, 1.42], pan: [[40, 0], [30, -10]], fadeOut: .3 }),
  // EXPLORE
  C('moon', 55.0, 60.0, { in: 0, speed: .85, zoom: [1.0, 1.08] }),
  C('lm', 60.0, 63.0, { in: 118, zoom: [1.12, 1.22], pan: [[0, 50], [0, 60]] }),
  C('eva', 63.0, 66.0, { in: 20, zoom: [1.0, 1.05] }),
  C('cabin', 66.0, 69.0, { in: 20, zoom: [1.0, 1.04] }),
  C('edl', 69.0, 71.0, { in: 20, zoom: [1.0, 1.06] }),
  C('rover', 71.0, 74.0, { in: 30, zoom: [1.0, 1.05] }),
  C('draco', 74.0, 75.5, { in: 60, zoom: [1.0, 1.08] }),
  C('dart', 75.5, 78.0, { in: 179, zoom: [1.0, 1.05] }),
  C('iss', 78.0, 81.0, { in: 30, zoom: [1.0, 1.05] }),
  C('reentry', 81.0, 82.8, { in: 20, zoom: [1.0, 1.05] }),
  C('splash8', 82.8, 84.0, { in: 30, zoom: [1.0, 1.05] }),
  C('splash', 84.0, 85.0, { in: 0, zoom: [1.04, 1.08] }),
  // MONTAGE 85-89
  C('launch_lowlift', 85.0, 85.5, { in: 36, zoom: [1.05, 1.0] }),
  C('staging', 85.5, 86.0, { in: 140, zoom: [1.7, 1.8], pan: [[0, 50], [0, 50]] }),
  C('lmascent', 86.0, 86.5, { in: 30 }),
  C('dart', 86.5, 87.0, { in: 290, zoom: [1.1, 1.18] }),
  C('marslow', 87.0, 87.5, { in: 60 }),
  C('kennedy_top', 87.5, 88.0, { in: 40 }),
  C('moonship', 88.0, 88.5, { in: 40 }),
  C('launch_track', 88.5, 89.0, { in: 126, zoom: [1.0, 1.08] }),
  // TECH WALL / LOGO backgrounds
  C('earth', 89.0, 94.0, { in: 120, speed: .5, zoom: [1.1, 1.16], grade: { b: .42, c: 1.0, s: .9 }, blur: 7 }),
  C('orbit', 94.0, 101.0, { in: 60, speed: .4, zoom: [1.08, 1.16], grade: { b: .48, c: 1.05, s: 1.05 }, blur: 6, fadeOut: 2.2 }),
];

const plate = (start, end, kick, title, chips, o = {}) => ({ type: 'plate', start, end, kick, title, chips, ...o });
const tag = (start, end, parts) => ({ type: 'tag', start, end, parts });
const items = [
  { type: 'frame', start: 1.4, end: 99.0, label: 'REC · IN-ENGINE FOOTAGE' },
  { type: 'state', align: 'left', start: 2.0, end: 7.7, kick: 'JUGRE SPACE PROJECT', lines: ['Каждый килограмм.', 'Каждый ньютон.', '<em>Каждая секунда.</em>'], stagger: .7 },
  tag(8.3, 11.8, ['ФЛОРИДА / КЕННЕДИ', 'LC-39A']),
  plate(8.5, 11.8, 'Реальные геоданные', 'Космический центр Кеннеди', ['ортофото USGS NAIP', '<b>0,34 м</b> на тексель у LC-39A', 'VAB · LC-39A · LC-39B']),
  { type: 'card', start: 12.0, end: 13.9, num: '01', title: 'СОБЕРИ', sub: 'АНГАР · КОНСТРУКТОР · ЛАБОРАТОРИЯ' },
  plate(14.0, 16.3, 'Процедурная генерация', `Ангар, ракеты, экипаж — ${cyan('из кода')}`, ['Three.js r187 · WebGL', 'glTF / GLB', 'ACES-тонмаппинг и тени']),
  plate(16.6, 20.1, 'Ручной конструктор', 'Каждая деталь — инженерный узел', ['дерево креплений', 'профили стыков', 'реальные массы и тяга', 'многоступенчатость']),
  plate(20.4, 23.5, 'Payload Lab', `16 научных приборов`, ['энергобаланс и затмения', 'память и радиосвязь', 'наземные станции']),
  plate(23.8, 25.5, 'Mission Planner', `От орбиты Земли ${cyan('до Нептуна')}`, ['Standard и Engineering', 'подбор носителя', 'PASS · FAIL · UNKNOWN'], { backdrop: true }),
  plate(25.75, 27.95, 'SI · ИИ-планировщик', `Опиши миссию ${cyan('словами')}`, ['предложение от ИИ', 'проверка инженерным движком игры'], { backdrop: true }),
  tag(28.0, 28.4, ['APOLLO 11', 'SATURN V']), tag(28.4, 28.8, ['ARTEMIS II', 'SLS BLOCK 1']), tag(28.8, 29.2, ['MARS 2020', 'ATLAS V 541']),
  tag(29.2, 29.6, ['DART', 'FALCON 9']), tag(29.6, 30.0, ['VOYAGER 2', 'TITAN IIIE']),
  { type: 'card', start: 30.0, end: 31.9, num: '02', title: 'ЗАПУСТИ', sub: 'КЕННЕДИ · LC-39A · SATURN V' },
  { type: 'count', start: 32.3, end: 33.3, n: '10' }, { type: 'count', start: 34.5, end: 35.4, n: '3' },
  { type: 'count', start: 35.5, end: 36.4, n: '2' }, { type: 'count', start: 36.5, end: 37.3, n: '1' },
  plate(43.3, 46.9, 'Физика выведения', 'LaunchDynamics · шаг 1/120 с', ['тяга и расход топлива', 'сопротивление атмосферы', 'вращающаяся Земля'], { pos: 'top' }),
  plate(47.3, 50.9, 'Физический движок', `NVIDIA PhysX 5 · ${cyan('WebAssembly')}`, ['отделение ступеней', 'контакты и обломки', 'стыковка · <b>fixed joint</b>']),
  tag(51.2, 54.8, ['ОРБИТА ЗЕМЛИ', 'APOLLO 11']),
  { type: 'card', start: 55.0, end: 56.9, num: '03', title: 'ИССЛЕДУЙ', sub: 'ЛУНА · МАРС · АСТЕРОИДЫ · МКС' },
  plate(57.0, 59.9, 'Небесная механика', `Кеплер · Ламберт · ${cyan('сферы влияния')}`, ['универсальное уравнение Кеплера', 'задача Ламберта', 'сопряжённые конические сечения']),
  tag(60.2, 62.9, ['ЛУНА / МОРЕ СПОКОЙСТВИЯ', 'EAGLE']),
  plate(66.2, 68.9, 'Жизнеобеспечение', 'O₂ · CO₂ · вода · энергия', ['посекундный расчёт', 'свободные предметы в PhysX', 'отказы и утечки']),
  tag(69.2, 70.9, ['МАРС', 'ВХОД · СПУСК · ПОСАДКА']),
  tag(71.2, 73.9, ['МАРС / КРАТЕР ЕЗЕРО', 'PERSEVERANCE']),
  tag(74.1, 75.4, ['DRACO', 'ТЕРМИНАЛЬНОЕ НАВЕДЕНИЕ']),
  tag(75.6, 77.9, ['DIDYMOS · DIMORPHOS', 'DART']),
  plate(78.2, 80.9, 'Звук · Web Audio', 'Живой эфир ЦУПа', ['40+ радиореплик', 'звук гаснет в вакууме', 'синтез двигателей']),
  tag(81.2, 84.9, ['ВОЗВРАЩЕНИЕ', 'APOLLO 11']),
  { type: 'wall', start: 89.0, end: 94.0, head: 'ТЕХНОЛОГИИ JUGRE', cells: [
    ['РЕНДЕР', 'Three.js r187 · WebGL', 'ACES, тени, процедурный рельеф Луны и Марса'],
    ['ФИЗИКА', 'PhysX 5 · WASM', 'ступени, стыковка, кабина, обломки'],
    ['БАЛЛИСТИКА', 'Кеплер · Ламберт', 'выведение с шагом 1/120 с в единицах СИ'],
    ['ГЕОДАННЫЕ', 'USGS NAIP', 'реальная съёмка Кеннеди и Флориды'],
    ['SI', 'ИИ-планировщик', 'миссия из текста → проверка движком'],
    ['ПЛАТФОРМА', 'Один HTML-файл', 'офлайн-игра · Windows-сборка на Electron'],
  ] },
  { type: 'logo', start: 94.0, end: 100.6, tagline: 'Beyond the horizon.', tri: 'СОБЕРИ · ЗАПУСТИ · ИССЛЕДУЙ', foot: 'ВСЕ КАДРЫ — ЗАПИСЬ ИЗ ДВИЖКА ИГРЫ<br>JUGRE SPACE PROJECT · 0.1.0 TEST' },
];
// radio subtitles from the cue sheet (skip bare countdown numbers, which get big numerals)
const highRadio = new Set(['maxq']);
for (const v of cues.voice) {
  if (/^count_[1-9]$/.test(v.clip)) continue;
  const dur = { preflight: 2.9, count_10: .95, ignition: .8, liftoff: .8 }[v.clip] ?? Math.max(1.8, v.ru.length * .055);
  items.push({ type: 'radio', start: v.at - .05, end: v.at + dur + .5, who: v.who, ru: v.ru, en: v.en, pos: highRadio.has(v.clip) ? 'high' : 'bottom' });
}
const fx = [
  { kind: 'flash', at: 12.0, pre: .08, len: .45, amt: .55 },
  { kind: 'dip', at: 12.0, pre: .01, hold: 1.3, len: .7, amt: .6 },
  { kind: 'flash', at: 30.0, pre: .08, len: .45, amt: .5 },
  { kind: 'dip', at: 30.0, pre: .01, hold: 1.3, len: .7, amt: .55 },
  { kind: 'warm', at: 37.6, pre: .2, len: 1.6, amt: .35 },
  { kind: 'flash', at: 39.0, pre: .06, len: .7, amt: .85 },
  { kind: 'warm', at: 39.2, pre: .2, len: 3.5, amt: .45 },
  { kind: 'flash', at: 47.0, pre: .05, len: .35, amt: .45 },
  { kind: 'flash', at: 55.0, pre: .08, len: .45, amt: .5 },
  { kind: 'dip', at: 55.0, pre: .01, hold: 1.3, len: .7, amt: .5 },
  { kind: 'flash', at: cues.dartImpact, pre: .04, len: .8, amt: 1.0 },
  { kind: 'flash', at: 89.0, pre: .06, len: .5, amt: .6 },
  { kind: 'flash', at: 94.0, pre: .06, len: .7, amt: .7 },
  { kind: 'dip', at: 1.0, pre: .01, len: .01, amt: 0 },
];
// quick montage flashes
for (let t = 85.5; t < 89; t += .5) fx.push({ kind: 'flash', at: t, pre: .02, len: .12, amt: .25 });
const edit = { fps: FPS, duration: cues.duration, clips, items, fx, bars: [{ start: 30.0, end: 43.0 }] };
fs.writeFileSync('comp/edit.js', 'module.exports = ' + JSON.stringify(edit, null, 1) + ';\n');
const missing = [...new Set(clips.filter(c => !c.frames).map(c => c.src))];
console.log('clips', clips.length, 'items', items.length, 'missing', missing.join(' '));
for (const c of clips) { const need = c.in + Math.round((c.end - c.start) * FPS * (c.speed ?? 1)); if (c.frames && need > c.frames) console.log('SHORT', c.src, 'need', need, 'have', c.frames); }
