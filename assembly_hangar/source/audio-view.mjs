import { AudioManager, audioDefaults } from './audio-manager.mjs';

const el = id => document.getElementById(id);

export function setupHangarAudio(decode) {
  const caption = el('radio-subtitle');
  const dialog = el('audio-dialog');
  let storage;
  try { storage = globalThis.localStorage; } catch { /* Settings remain available during the session. */ }
  const audio = new AudioManager({
    storage,
    voiceData(id) {
      const block = el(`audio-data-${id}`);
      return block ? decode(block.textContent).buffer : null;
    },
    subtitle(item) {
      caption.hidden = !item;
      if (!item) {
        delete caption.dataset.line;
        return;
      }
      caption.dataset.line = item.id;
      el('radio-speaker').textContent = item.speaker;
      el('radio-text').textContent = item.text;
    },
  });

  function settingsUI() {
    for (const [key, value] of Object.entries(audio.settings)) {
      const input = el(`audio-${key}`);
      if (key === 'subtitles') input.checked = value;
      else {
        input.value = Math.round(value * 100);
        el(`audio-${key}-value`).textContent = `${input.value} %`;
      }
    }
  }
  settingsUI();
  el('audio-settings').addEventListener('click', () => { settingsUI(); dialog.showModal(); });
  el('audio-reset').addEventListener('click', () => {
    for (const [key, value] of Object.entries(audioDefaults)) audio.setting(key, value);
    settingsUI();
  });
  for (const key of Object.keys(audioDefaults)) {
    const input = el(`audio-${key}`);
    input.addEventListener('input', () => {
      audio.setting(key, key === 'subtitles' ? input.checked : Number(input.value) / 100);
      if (key !== 'subtitles') el(`audio-${key}-value`).textContent = `${input.value} %`;
    });
  }
  document.addEventListener('click', event => {
    const control = event.target.closest('button, summary');
    if (!control || control.disabled) return;
    void audio.unlock().then(() => audio.fx('click', 'ui', .64));
  }, true);
  document.addEventListener('change', event => {
    if (event.target.matches('select, #flight-throttle, #audio-subtitles')) {
      void audio.unlock().then(() => audio.fx('switch', 'ui', .63));
    }
  });
  return audio;
}
