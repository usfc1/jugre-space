import { groups, propellants } from './catalog.mjs';

const language = {
  ru: {
    locale: 'ru-RU', title: 'Детали JUGRE',
    intro: 'Игровые характеристики для карточек конструктора. В наборе 25 типов деталей и 26 моделей GLB. У обтекателя отдельные левая и правая створки.',
    units: 'Размеры меша приведены как X × Y × Z. Диаметр крепления — номинальный. Тяга и удельный импульс указаны в порядке «уровень моря / вакуум».',
    headers: ['Деталь', 'Масса', 'Размеры меша', 'Крепление', 'Параметры'],
    mass: 'кг', meter: 'м', time: 'с', force: 'кН', area: 'м²', power: 'кВт', energy: 'кВт·ч', oxygen: 'чел·мин',
    radial: 'Боковое крепление', equipment: '4 грузовые площадки', recovery: 'Разъём парашютного блока',
    fairingBase: '2 замка створок', fairingSide: (side) => side === 'left' ? 'Левый замок ОБ-25' : 'Правый замок ОБ-25',
    fuel: (value) => `Топливо — ${value}`, thrust: (value) => `Тяга ${value}`, impulse: (value) => `Удельный импульс ${value}`,
    capacity: (value) => `Запас ${value}`, full: (value) => `Заправленная масса ${value}`,
    height: (value) => `Высота ${value}`, maxBooster: (value) => `Ускоритель до ${value}`,
    slots: (count, diameter) => `${count} гнезда Ø${diameter} под К-125`,
    surface: (value) => `Площадь ${value}`, deflection: (value) => `Отклонение до ${value}`,
    output: (value) => `Мощность до ${value}`, seats: (value) => `Места экипажа — ${value}`,
    battery: (value) => `Батарея ${value}`, air: (value) => `Запас кислорода ${value}`,
    draw: (value) => `Потребление ${value}`, payload: (value) => `Груз до ${value}`,
    clearance: (diameter, height) => `Груз до Ø${diameter} × ${height}`,
  },
  en: {
    locale: 'en-US', title: 'JUGRE Parts',
    intro: 'Gameplay specifications for the construction catalog. The set has 25 part types and 26 GLB models. The left and right fairing shells are separate models.',
    units: 'Mesh dimensions are listed as X × Y × Z. Attachment diameters are nominal. Thrust and specific impulse are listed in sea-level / vacuum order.',
    headers: ['Part', 'Mass', 'Mesh size', 'Attachment', 'Specifications'],
    mass: 'kg', meter: 'm', time: 's', force: 'kN', area: 'm²', power: 'kW', energy: 'kWh', oxygen: 'person-min',
    radial: 'Radial mount', equipment: '4 payload mounts', recovery: 'Parachute port',
    fairingBase: '2 shell latches', fairingSide: (side) => side === 'left' ? 'Left OB-25 latch' : 'Right OB-25 latch',
    fuel: (value) => `Propellant — ${value}`, thrust: (value) => `Thrust ${value}`, impulse: (value) => `Specific impulse ${value}`,
    capacity: (value) => `Capacity ${value}`, full: (value) => `Loaded mass ${value}`,
    height: (value) => `Height ${value}`, maxBooster: (value) => `Booster up to ${value}`,
    slots: (count, diameter) => `${count} K-125 seats at Ø${diameter}`,
    surface: (value) => `Area ${value}`, deflection: (value) => `Deflection up to ${value}`,
    output: (value) => `Peak output ${value}`, seats: (value) => `${value} crew seats`,
    battery: (value) => `Battery ${value}`, air: (value) => `Oxygen reserve ${value}`,
    draw: (value) => `Power draw ${value}`, payload: (value) => `Payload up to ${value}`,
    clearance: (diameter, height) => `Payload up to Ø${diameter} × ${height}`,
  },
};

function attachment(spec, lang, display) {
  const { stats } = spec;
  const diameters = [...new Set(Object.values(spec.mounts).map((port) => port.nominalDiameterM).filter(Boolean))];
  const extras = [];
  if (Object.values(spec.mounts).some((port) => port.profile === 'jugre_radial')) extras.push(lang.radial);
  if (stats.payloadMounts) extras.push(lang.equipment);
  if (stats.crewSeats) extras.push(lang.recovery);
  if (stats.fairingLatches) extras.push(lang.fairingBase);
  if (stats.side) extras.push(lang.fairingSide(stats.side));
  return [...diameters.map((value) => `Ø${display(value, lang.meter)}`), ...extras].join(' · ');
}

function parameters(spec, locale, lang, display) {
  const { stats, massKg } = spec;
  const result = [];
  if (stats.propellant) result.push(lang.fuel(propellants[stats.propellant][locale]));
  if (stats.thrustKN) {
    result.push(lang.thrust(`${display(stats.thrustKN.seaLevel)} / ${display(stats.thrustKN.vacuum, lang.force)}`));
    result.push(lang.impulse(`${display(stats.specificImpulseS.seaLevel)} / ${display(stats.specificImpulseS.vacuum, lang.time)}`));
  }
  if (stats.heightM) result.push(lang.height(display(stats.heightM, lang.meter)));
  if (stats.capacityKg) {
    result.push(lang.capacity(display(stats.capacityKg, lang.mass)));
    result.push(lang.full(display(stats.capacityKg + massKg, lang.mass)));
  }
  if (stats.engineSlots) result.push(lang.slots(stats.engineSlots, display(stats.engineMountDiameterM, lang.meter)));
  if (stats.maxBoosterMassKg) result.push(lang.maxBooster(display(stats.maxBoosterMassKg, lang.mass)));
  if (stats.areaM2) result.push(lang.surface(display(stats.areaM2, lang.area)));
  if (stats.maxDeflectionDeg) result.push(lang.deflection(`±${display(stats.maxDeflectionDeg)}°`));
  if (stats.peakPowerKW) result.push(lang.output(display(stats.peakPowerKW, lang.power)));
  if (stats.crewSeats) result.push(lang.seats(stats.crewSeats));
  if (stats.batteryKWh) result.push(lang.battery(display(stats.batteryKWh, lang.energy)));
  if (stats.oxygenPersonMinutes) result.push(lang.air(display(stats.oxygenPersonMinutes, lang.oxygen)));
  if (stats.powerDrawKW) result.push(lang.draw(display(stats.powerDrawKW, lang.power)));
  if (stats.maxPayloadMassKg) result.push(lang.payload(display(stats.maxPayloadMassKg, lang.mass)));
  if (stats.maxPayloadHeightM) result.push(lang.clearance(display(stats.maxPayloadDiameterM), display(stats.maxPayloadHeightM, lang.meter)));
  return [...result, spec.use[locale].replace(/\.$/, '')].join('. ') + '.';
}

export function specifications(parts, locale) {
  const lang = language[locale];
  const numbers = new Intl.NumberFormat(lang.locale, { maximumFractionDigits: 2 });
  const display = (value, unit) => numbers.format(value) + (unit ? ` ${unit}` : '');
  const lines = [`# ${lang.title}`, '', lang.intro, '', lang.units, ''];
  for (const [group, label] of Object.entries(groups)) {
    lines.push(`## ${label[locale]}`, '', `| ${lang.headers.join(' | ')} |`, '| --- | ---: | --- | --- | --- |');
    for (const spec of Object.values(parts).filter((part) => part.group === group)) {
      const [x, y, z] = spec.dimensionsM;
      const size = `${display(x)} × ${display(y)} × ${display(z, lang.meter)}`;
      const label = locale === 'ru' ? `${spec.code} «${spec.name[locale]}»` : `${spec.code} ${spec.name[locale]}`;
      const fields = [`**${label}**`, display(spec.massKg, lang.mass), size, attachment(spec, lang, display),
        parameters(spec, locale, lang, display)];
      lines.push(`| ${fields.join(' | ')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
