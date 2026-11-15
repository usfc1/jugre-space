export const speakers = {
  control: { name: 'Mission Control', voice: 'af_sarah', speed: 0.98 },
  crew: { name: 'Crew', voice: 'am_michael', speed: 1.02 },
  computer: { name: 'Flight Computer', voice: 'am_adam', speed: 1.02 },
};

const line = (speaker, en, ru, priority = 30) => ({ speaker, en, ru, priority });
const numbers = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'T-minus ten'];
export const radioLines = {
  ...Object.fromEntries(numbers.map((word, i) => [`count_${i + 1}`,
    line('control', `${word[0].toUpperCase()}${word.slice(1)}.`, i === 9 ? 'До старта десять секунд.' : `${i + 1}.`, 100)])),
  preflight: line('control', 'All stations go. Proceed to terminal count.', 'Все посты готовы. Разрешаю финальный отсчёт.', 45),
  preflight_crew: line('crew', 'Checklist complete. Crew is ready.', 'Проверка завершена. Экипаж готов к запуску.', 45),
  preflight_auto: line('computer', 'Vehicle checks complete. Telemetry nominal.', 'Проверка аппарата завершена. Телеметрия в норме.', 45),
  ignition: line('control', 'Ignition.', 'Зажигание.', 100),
  liftoff: line('control', 'Liftoff!', 'Старт!', 100),
  ascent_crew: line('crew', 'We are clear of the tower. Guidance looks good.', 'Вышку прошли. Наведение в норме.', 32),
  ascent_auto: line('computer', 'Tower clear. Ascent guidance active.', 'Вышка пройдена. Наведение на подъёме активно.', 32),
  maxq: line('control', 'We are past maximum dynamic pressure.', 'Пик скоростного напора пройден.', 47),
  stage: line('computer', 'Stage separation confirmed.', 'Разделение ступеней подтверждено.', 52),
  stage_ignition: line('computer', 'Next stage ignition confirmed.', 'Зажигание следующей ступени подтверждено.', 38),
  orbit: line('control', 'Orbital insertion confirmed. You are in Earth orbit.', 'Выведение подтверждено. Аппарат на орбите Земли.', 46),
  approach: line('control', 'Range is closing. You are cleared for final approach to the station.', 'Дистанция сокращается. Разрешаю финальное сближение со станцией.', 40),
  dock: line('computer', 'Contact. Docking latches are secured.', 'Контакт. Замки стыковочного узла закрыты.', 56),
  undock: line('computer', 'Lander separation confirmed.', 'Отделение посадочного модуля подтверждено.', 43),
  correction: line('computer', 'Course correction burn in progress.', 'Выполняется импульс коррекции траектории.', 43),
  lunar_descent: line('control', 'Lander, you are go for powered descent.', 'Посадочный модуль, разрешаю управляемый спуск.', 45),
  moon_touch: line('crew', 'Contact confirmed. We are on the lunar surface.', 'Контакт подтверждён. Мы на поверхности Луны.', 58),
  moon_touch_auto: line('computer', 'Lunar touchdown confirmed.', 'Посадка на Луну подтверждена.', 58),
  mars_descent: line('computer', 'Mars descent sequence is active.', 'Начата последовательность спуска на Марс.', 43),
  mars_touch: line('computer', 'Touchdown confirmed. The rover is on the surface.', 'Касание подтверждено. Марсоход на поверхности.', 58),
  splash: line('computer', 'Water contact confirmed. Recovery mode active.', 'Касание воды подтверждено. Включён режим эвакуации.', 55),
  parachutes: line('computer', 'Parachutes deployed.', 'Парашюты раскрыты.', 39),
  probe_impact: line('control', 'Target impact confirmed. The test objective is complete.', 'Попадание подтверждено. Цель испытания достигнута.', 58),
  hot: line('computer', 'Engine temperature critical!', 'Критическая температура двигателя!', 83),
  fuel: line('computer', 'Fuel level critical!', 'Критически низкий остаток топлива!', 80),
  guidance: line('computer', 'Trajectory deviation detected!', 'Обнаружено отклонение от траектории!', 79),
  structure: line('computer', 'Structural failure imminent!', 'Угроза разрушения конструкции!', 89),
  link_lost: line('computer', 'Communication lost!', 'Связь потеряна!', 82),
  link_restored: line('control', 'Signal acquired. Telemetry is back.', 'Сигнал принят. Телеметрия восстановлена.', 49),
  abort: line('control', 'Launch aborted. Safing the vehicle.', 'Запуск отменён. Переводим ракету в безопасный режим.', 120),
  failure: line('computer', 'Critical failure. Mission aborted.', 'Критический отказ. Миссия прервана.', 110),
  success: line('control', 'Mission accomplished!', 'Миссия выполнена!', 54),
  success_auto: line('computer', 'Mission accomplished!', 'Миссия выполнена!', 54),
};

const phaseCalls = {
  orbit: 'orbit', stationApproach: 'approach', moonLanding: 'lunar_descent', marsLanding: 'mars_descent',
};
const eventCalls = {
  maxQ: 'maxq', stage: 'stage', stageIgnition: 'stage_ignition', dock: 'dock', undock: 'undock',
  correction: 'correction', marsTouch: 'mars_touch', splash: 'splash', parachutes: 'parachutes',
  probeImpact: 'probe_impact', launchAbort: 'abort', failure: 'failure',
};

// Optional per-mission overrides. Add clips to radioLines and reference them here.
export const missionVoicePacks = {};

export function radioFor({ type, detail }, { id, crew, link }) {
  const overrides = missionVoicePacks[id];
  const override = overrides?.[type === 'phase' ? `phase:${detail.kind}` : type];
  let defaults = eventCalls[type] ? [eventCalls[type]] : [];
  if (type === 'preflight') defaults = ['preflight', crew ? 'preflight_crew' : 'preflight_auto'];
  if (type === 'count') defaults = [`count_${detail.value}`];
  if (type === 'liftoff') defaults = ['ignition', 'liftoff'];
  if (type === 'towerClear') defaults = [crew ? 'ascent_crew' : 'ascent_auto'];
  if (type === 'phase' && phaseCalls[detail.kind]) defaults = [phaseCalls[detail.kind]];
  if (type === 'moonTouch') defaults = [crew ? 'moon_touch' : 'moon_touch_auto'];
  if (type === 'warning') defaults = [detail.id];
  if (type === 'link') defaults = [detail.available ? 'link_restored' : 'link_lost'];
  if (type === 'success') defaults = [link ? 'success' : 'success_auto'];
  return (override ?? defaults).filter((key) => {
    const role = radioLines[key]?.speaker;
    return role && (role !== 'crew' || crew) && (link || role === 'computer');
  });
}
