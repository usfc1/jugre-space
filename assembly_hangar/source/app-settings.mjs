export const SETTINGS_KEY = 'jugre.settings.v1';
export const settingsDefaults = Object.freeze({
  language: 'en', scale: 100, fullscreen: false, animations: true, hints: true,
  quality: 'high', shadows: true, antialias: true, ambience: true,
  sensitivity: 100, damping: true, telemetry: true, tracking: true,
  assistance: 'standard', mute: false,
});

export function readSettings(storage) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}') || {}; } catch { /* Use defaults. */ }
  const result = { ...settingsDefaults };
  for (const key of ['fullscreen', 'animations', 'hints', 'shadows', 'antialias', 'ambience', 'damping', 'telemetry', 'tracking', 'mute']) {
    if (typeof saved[key] === 'boolean') result[key] = saved[key];
  }
  for (const [key, values] of Object.entries({ language: ['en', 'ru'], quality: ['low', 'medium', 'high', 'ultra'], assistance: ['arcade', 'standard', 'realism'] })) {
    if (values.includes(saved[key])) result[key] = saved[key];
  }
  for (const [key, min, max] of [['scale', 85, 120], ['sensitivity', 25, 200]]) {
    if (Number.isFinite(saved[key])) result[key] = Math.max(min, Math.min(max, Math.round(saved[key])));
  }
  result.telemetry = true;
  return result;
}

export function storeSettings(storage, settings) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
