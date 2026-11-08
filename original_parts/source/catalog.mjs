const titles = (ru, en) => ({ ru, en });

export const groups = {
  propulsion: titles('Двигатели', 'Engines'),
  tanks: titles('Баки и баллоны', 'Tanks and pressure vessels'),
  structure: titles('Рамы, переходники и отделители', 'Mounts, adapters, and separators'),
  surfaces: titles('Стабилизаторы, рули и крылья', 'Fins, control surfaces, and wings'),
  payload: titles('Управление и полезная нагрузка', 'Control and payload'),
};

export const propellants = {
  kerolox: titles('керосин и жидкий кислород', 'kerosene and liquid oxygen'),
  nitrogen: titles('сжатый азот', 'compressed nitrogen'),
};

const part = (id, code, group, name, massKg, stats, use, catalogId = id) => (
  { id, code, group, catalogId, name, massKg, stats, use }
);

function engine(id, code, name, massKg, diameter, thrustKN, impulseS, use) {
  return part(id, code, 'propulsion', name, massKg, {
    mountDiameterM: diameter,
    propellant: diameter ? 'kerolox' : 'nitrogen',
    thrustKN: { seaLevel: thrustKN[0], vacuum: thrustKN[1] },
    specificImpulseS: { seaLevel: impulseS[0], vacuum: impulseS[1] },
  }, use);
}

function tank(id, code, name, massKg, diameter, heightM, capacityKg, use) {
  return part(id, code, 'tanks', name, massKg, {
    mountDiameterM: diameter, heightM, capacityKg,
    propellant: diameter ? 'kerolox' : 'nitrogen',
  }, use);
}

function wing(id, code, name, massKg, areaM2, extra, use) {
  return part(id, code, 'surfaces', name, massKg, { areaM2, ...extra }, use);
}

export const parts = [
  engine('k_35_iskra', 'K-35', titles('Искра', 'Spark'), 170, 1.25, [35, 42], [270, 324],
    titles('Стартовый двигатель лёгкой ракеты.', 'Launch engine for a light rocket.')),
  engine('k_125_klen', 'K-125', titles('Клён', 'Maple'), 410, 1.25, [125, 145], [275, 319],
    titles('Одиночная установка или блок из трёх двигателей на раме Р-253.', 'Single installation or a cluster of three on the R-253 plate.')),
  engine('k_420_kedr', 'K-420', titles('Кедр', 'Cedar'), 1570, 2.5, [420, 470], [283, 317],
    titles('Стартовый двигатель тяжёлой ступени.', 'Launch engine for a heavy stage.')),
  engine('k_155v_dalniy', 'K-155V', titles('Дальний', 'Longreach'), 480, 1.25, [95, 155], [224, 365],
    titles('Вакуумный двигатель верхней ступени с широким соплом.', 'Upper-stage vacuum engine with a wide nozzle.')),
  engine('r_08_shepot', 'R-08', titles('Шёпот', 'Whisper'), 12, null, [0.8, 0.8], [60, 60],
    titles('Боковое сопло ориентации и малых коррекций. Питается от Г-060.', 'Side-mounted thruster for attitude control and small corrections. Fed by the G-060 tank.')),

  tank('b_12_sota', 'B-12', titles('Сота', 'Cell'), 145, 1.25, 1.50, 1200,
    titles('Компактный бак лёгкой ступени.', 'Compact tank for a light stage.')),
  tank('b_32_stvol', 'B-32', titles('Ствол', 'Spine'), 285, 1.25, 3.20, 3200,
    titles('Удлинённый бак того же диаметра.', 'Longer tank with the same attachment diameter.')),
  tank('b_140_bochka', 'B-140', titles('Бочка', 'Barrel'), 980, 2.5, 3.50, 14000,
    titles('Основной бак ступени среднего размера.', 'Main tank for a medium-sized stage.')),
  tank('b_240_rezerv', 'B-240', titles('Резерв', 'Reserve'), 1620, 2.5, 6.00, 24000,
    titles('Удлинённый бак тяжёлой ступени.', 'Extended tank for a heavy stage.')),
  tank('g_060_puls', 'G-060', titles('Пульс', 'Pulse'), 24, null, 0.52, 60,
    titles('Боковой блок баллонов для двигателей ориентации Р-08.', 'Side-mounted pressure vessel pack for R-08 thrusters.')),

  part('r_253_triada', 'R-253', 'structure', titles('Триада', 'Triad'), 250,
    { mountDiameterM: 2.5, engineMountDiameterM: 1.25, engineSlots: 3, compatibleEngineId: 'k_125_klen' },
    titles('Двигательная рама на три К-125.', 'Engine plate for three K-125 engines.')),
  part('p_2512_konus', 'P-2512', 'structure', titles('Конус', 'Cone'), 145,
    { forwardDiameterM: 2.5, aftDiameterM: 1.25, heightM: 0.55 },
    titles('Соединяет широкую секцию с узкой. Для обратной установки переходник переворачивается.', 'Joins a wide section to a narrow one. Flip the adapter to reverse the order.')),
  part('o_12_schelchok', 'O-12', 'structure', titles('Щелчок', 'Click'), 55,
    { mountDiameterM: 1.25, heightM: 0.18, staging: 'axialSeparation' },
    titles('Отделяет нижнюю секцию по команде ступени.', 'Releases the lower section on a staging command.')),
  part('o_25_razryv', 'O-25', 'structure', titles('Разрыв', 'Breakaway'), 135,
    { mountDiameterM: 2.5, heightM: 0.22, staging: 'axialSeparation' },
    titles('Отделитель широкой ступени.', 'Axial separator for a wide stage.')),
  part('bk_6_zamok', 'BK-6', 'structure', titles('Замок', 'Latch'), 95,
    { maxBoosterMassKg: 6000, staging: 'radialSeparation' },
    titles('Боковой замок сбрасывает один ускоритель по команде ступени.', 'Radial latch releases one booster on a staging command.')),

  wing('s_22_pero', 'S-22', titles('Перо', 'Feather'), 14, 0.22, {},
    titles('Лёгкий неподвижный стабилизатор.', 'Light fixed stabilizer.')),
  wing('s_65_kil', 'S-65', titles('Киль', 'Keel'), 38, 0.65, {},
    titles('Неподвижный стабилизатор тяжёлой ступени.', 'Fixed stabilizer for a heavy stage.')),
  wing('r_42_lopast', 'R-42', titles('Лопасть', 'Vane'), 32, 0.42, { maxDeflectionDeg: 20 },
    titles('Поворотный аэродинамический руль.', 'Pivoting aerodynamic control surface.')),
  wing('rr_49_reshetka', 'RR-49', titles('Решётка', 'Grid'), 66, 0.49, { maxDeflectionDeg: 25, deployable: true },
    titles('Складной решётчатый руль для управления ступенью на спуске.', 'Folding grid fin for controlling a returning stage.')),
  wing('sk_18_luch', 'SK-18', titles('Луч', 'Ray'), 42, 6, { peakPowerKW: 1.8, deployable: true },
    titles('Складное солнечное крыло. Пиковая мощность при прямом освещении.', 'Folding solar wing. Peak output is measured in direct light.')),

  part('pk_2_kontur', 'PK-2', 'payload', titles('Контур', 'Contour'), 1450,
    { mountDiameterM: 2.5, crewSeats: 2, batteryKWh: 2, oxygenPersonMinutes: 240 },
    titles('Пилотируемая кабина. Для возвращения добавляются теплозащита и парашют.', 'Crew capsule. Add a heat shield and parachute for recovery.')),
  part('pb_1_strizh', 'PB-1', 'payload', titles('Стриж', 'Swift'), 80,
    { mountDiameterM: 1.25, batteryKWh: 0.5, powerDrawKW: 0.10 },
    titles('Беспилотный командный блок с собственной батареей.', 'Uncrewed control core with its own battery.')),
  part('pn_1_polka', 'PN-1', 'payload', titles('Полка', 'Shelf'), 92,
    { mountDiameterM: 1.25, payloadMounts: 4, maxPayloadMassKg: 650 },
    titles('Открытая рама для крепления полезной нагрузки.', 'Open frame for mounting payload equipment.')),
  part('ob_25_poyas', 'OB-25', 'payload', titles('Пояс', 'Belt'), 95,
    { mountDiameterM: 2.5, fairingLatches: 2 },
    titles('Основание обтекателя с отдельными замками для левой и правой створок.', 'Fairing base with separate latches for the left and right shells.')),
  ...['left', 'right'].map((side) => part(`st_25_stvorka_${side}`, `ST-25-${side === 'left' ? 'L' : 'R'}`, 'payload',
    side === 'left' ? titles('Створка левая', 'Shell, left') : titles('Створка правая', 'Shell, right'), 85,
    { side, requiredBaseId: 'ob_25_poyas', outerDiameterM: 2.5, maxPayloadDiameterM: 2.10, maxPayloadHeightM: 1.80, staging: 'fairingJettison' },
    titles('Отдельно сбрасываемая половина обтекателя. Габарит груза указан для пары створок.', 'Independently jettisonable fairing half. Payload clearance applies to the paired shells.'),
    'st_25_stvorka')),
];
