import { audioDefaults } from './audio-manager.mjs';
import { controlProfiles, profileBindings } from './control-profiles.mjs';
import { ControlBindings, keyLabel } from './flight-controls.mjs';
import { settingsDefaults, storeSettings } from './app-settings.mjs';

const ru = {
  menuKicker:'ВАШЕ ПУТЕШЕСТВИЕ НАЧИНАЕТСЯ ЗДЕСЬ', menuTitle:'За горизонтом.', menuIntro:'Создавайте. Исследуйте. Открывайте.',
  continue:'Продолжить', resume:'ПРОДОЛЖИТЬ ПОЛЁТ', newMission:'Новая миссия', missions:'Миссии', assembly:'Сборка корабля', projects:'Проекты', settings:'Настройки', credits:'Авторы', exit:'Выйти из игры',
  settingsIntro:'Настройте игру под себя.', general:'Общие', graphics:'Графика', audio:'Звук', controls:'Управление', gameplay:'Игра',
  generalIntro:'Настройте интерфейс.', language:'Язык меню', languageHint:'Остальной интерфейс симулятора сохраняет существующий язык.', scale:'Масштаб интерфейса', scaleHint:'Изменяет масштаб интерфейса симулятора.', fullscreen:'Полный экран', fullscreenHint:'После перезапуска может потребоваться нажать кнопку ещё раз.', animations:'Анимация интерфейса', animationsHint:'Движение фона и переходы меню.', hints:'Подсказки', hintsHint:'Показывать подсказки камеры и управления.',
  graphicsIntro:'Баланс качества изображения и производительности.', quality:'Качество рендеринга', qualityHint:'Разрешение рендеринга и предустановка теней.', shadows:'Тени', shadowsHint:'Отображать тени сцены.', antialias:'Сглаживание', restartHint:'Применяется после перезапуска приложения.', ambience:'Эффекты фона', ambienceHint:'Движение звёзд и орбитального фона.', display:'Экран', graphicsNote:'Разрешение окна и V-Sync задаются браузером или операционной системой. Качество текстур определяется ресурсами игры.',
  audioIntro:'Настройте звуковые каналы симулятора.', master:'Общая громкость', music:'Музыка', effects:'Звуковые эффекты', voices:'Радио / голоса', voicesHint:'Радиосвязь и голоса используют один канал.', interfaceSound:'Звуки интерфейса', subtitles:'Субтитры радиосвязи', mute:'Выключить весь звук',
  controlsIntro:'Выберите профиль и действие, затем нажмите новую клавишу.', profile:'Профиль аппарата', action:'Действие', binding:'Текущая клавиша', bindingHint:'Escape отменяет назначение.', restoreControls:'Вернуть клавиши профиля', cameraControls:'Камера: перетаскивание — вращение · колесо — масштаб · правая кнопка — сдвиг.',
  gameplayIntro:'Настройте камеру и помощь в полёте.', sensitivity:'Чувствительность камеры', sensitivityHint:'Скорость вращения, сдвига и масштабирования.', damping:'Плавное движение камеры', tracking:'Сопровождение при старте', trackingHint:'Автоматически следить за ракетой при подъёме.', telemetry:'Телеметрия трансляции', telemetryHint:'Показывать шкалу миссии и данные полёта.', assistance:'Помощь в новых полётах', assistanceHint:'Сохранённые полёты сохраняют собственный режим.',
  reset:'Сбросить настройки', cancel:'Отмена', apply:'Применить', save:'Сохранить', close:'Закрыть', creditsBody:'Создано командой JUGRE Space Project. Используются Three.js и PhysX. Текстуры планет: Solar System Scope / INOVE (CC BY 4.0); снимки Земли: USDA / USGS The National Map. Голоса радиосвязи: Kokoro-82M. Фон меню создан с помощью ИИ. Подробные сведения включены в проект.',
  missionIntro:'Выберите раздел миссий.', historical:'Исторические миссии', historicalHint:'Выбрать доступную миссию на стартовой площадке.', customMissions:'Свои миссии', customMissionsHint:'Открыть сохранённые проекты миссий.',
};

export function setupMainMenu({ initial, renderer, controls, audio, flight, selectView, designer, standard, storage }) {
  const get = id => document.getElementById(id);
  const menu = get('main-menu'), shell = document.querySelector('.shell');
  const dialog = get('game-settings'), credits = get('game-credits');
  const missionDialog = get('game-missions');
  const status = get('settings-status'), saveStatus = get('menu-save-status');
  const defaultText = Object.fromEntries([...document.querySelectorAll('[data-i18n]')].map(el => [el.dataset.i18n, el.textContent]));
  const settingsInputs = [...dialog.querySelectorAll('[data-setting]')];
  const audioInputs = [...dialog.querySelectorAll('[data-audio]')];
  const tabs = [...dialog.querySelectorAll('[data-tab]')];
  let applied = { ...initial }, draft, audioDraft, bindingDraft, activeTab = 'general', capture = false;
  const liveBindings = flight.bindings;
  const tempStorage = { getItem: () => null, setItem: () => {} };
  const stagedBindings = new ControlBindings(tempStorage);
  const menuButtons = [...menu.querySelectorAll('[data-menu-action]')];
  const copy = obj => structuredClone(obj);
  const t = (en, translated) => applied.language === 'ru' ? translated : en;

  function translate() {
    document.documentElement.lang = applied.language;
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = applied.language === 'ru' ? (ru[el.dataset.i18n] ?? defaultText[el.dataset.i18n]) : defaultText[el.dataset.i18n];
    updateSaveStatus();
  }
  function updateSaveStatus() {
    const available = flight.hasCheckpoint();
    const button = menu.querySelector('[data-menu-action="continue"]');
    button.disabled = !available;
    saveStatus.textContent = available ? t('LOCAL FLIGHT SAVE AVAILABLE', 'СОХРАНЕНИЕ ПОЛЁТА ДОСТУПНО') : t('NO LOCAL FLIGHT SAVE', 'НЕТ СОХРАНЕНИЯ ПОЛЁТА');
  }
  function applyRuntime(config) {
    document.body.classList.toggle('no-ui-motion', !config.animations);
    document.body.classList.toggle('no-background-effects', !config.ambience);
    document.body.classList.toggle('hide-interface-hints', !config.hints);
    document.documentElement.style.setProperty('--jugre-scale', String(config.scale / 100));
    const ratios = { low: .75, medium: 1, high: 1.5, ultra: 2 };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratios[config.quality]));
    renderer.shadowMap.enabled = config.shadows;
    renderer.shadowMap.needsUpdate = true;
    controls.rotateSpeed = config.sensitivity / 100;
    controls.panSpeed = config.sensitivity / 100;
    controls.zoomSpeed = .65 * config.sensitivity / 100;
    controls.enableDamping = config.damping;
    audio.setMuted(config.mute);
    flight.setPreferences(config);
    window.dispatchEvent(new Event('resize'));
  }
  async function setFullscreen(wanted) {
    try {
      if (wanted && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!wanted && document.fullscreenElement) await document.exitFullscreen();
    } catch { status.textContent = t('Fullscreen requires browser permission or a user gesture.', 'Полный экран требует разрешения браузера или нажатия пользователя.'); }
  }
  function showTab(id, focus = false) {
    activeTab = id;
    for (const tab of tabs) { const selected = tab.dataset.tab === id; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected && focus) tab.focus(); }
    for (const panel of dialog.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== id;
  }
  function renderInputs() {
    for (const input of settingsInputs) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = draft[key]; else input.value = draft[key];
      const out = dialog.querySelector(`[data-value="${key}"]`); if (out) out.textContent = `${input.value}%`;
    }
    for (const input of audioInputs) {
      const key = input.dataset.audio;
      if (input.type === 'checkbox') input.checked = audioDraft[key]; else input.value = Math.round(audioDraft[key] * 100);
      const out = dialog.querySelector(`[data-audio-value="${key}"]`); if (out) out.textContent = `${input.value}%`;
    }
    get('settings-resolution').textContent = `${window.innerWidth} × ${window.innerHeight}`;
  }
  const profile = get('settings-profile'), action = get('settings-action'), keyButton = get('settings-key');
  profile.replaceChildren(...Object.entries(controlProfiles).map(([id, value]) => new Option(value.label, id)));
  function showKey() { keyButton.textContent = `${keyLabel(stagedBindings.key(profile.value, action.value))}  ·  ${t('change', 'изменить')}`; }
  function showProfile() {
    const entries = Object.entries(profileBindings(profile.value));
    action.replaceChildren(...entries.map(([id, value]) => new Option(value.label, id)));
    showKey();
  }
  function openSettings() {
    draft = { ...applied }; audioDraft = { ...audio.settings }; bindingDraft = copy(liveBindings.overrides);
    stagedBindings.overrides = bindingDraft;
    status.textContent = ''; get('settings-controls-status').textContent = '';
    renderInputs(); showProfile(); showTab(activeTab); dialog.showModal();
    dialog.querySelector('[aria-selected="true"]').focus();
  }
  function closeSettings() {
    if (!dialog.open || dialog.dataset.closing) return;
    if (!applied.animations || matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); return; }
    dialog.dataset.closing = 'true';
    setTimeout(() => { delete dialog.dataset.closing; if (dialog.open) dialog.close(); }, 160);
  }
  function applyDraft() {
    applied = { ...draft };
    for (const [key, value] of Object.entries(audioDraft)) audio.setting(key, value, { persist: false });
    liveBindings.overrides = copy(stagedBindings.overrides);
    applyRuntime(applied); translate();
    status.textContent = t('Applied for this session. Save to keep changes.', 'Применено для текущего сеанса. Сохраните изменения.');
    void setFullscreen(applied.fullscreen);
  }
  function saveDraft() {
    applyDraft();
    try {
      storeSettings(storage, applied); audio.persistSettings();
      const error = liveBindings.persist(); if (error) throw new Error(error);
      closeSettings();
    } catch { status.textContent = t('Could not save locally; changes remain active this session.', 'Не удалось сохранить настройки; изменения действуют в этом сеансе.'); }
  }
  for (const input of settingsInputs) input.addEventListener('input', () => {
    const key = input.dataset.setting;
    draft[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
    if (key === 'quality') draft.shadows = input.value !== 'low';
    renderInputs(); status.textContent = '';
  });
  for (const input of audioInputs) input.addEventListener('input', () => {
    audioDraft[input.dataset.audio] = input.type === 'checkbox' ? input.checked : Number(input.value) / 100;
    renderInputs(); status.textContent = '';
  });
  for (const tab of tabs) {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.indexOf(tab), delta = ['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1;
      showTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length].dataset.tab, true);
    });
  }
  profile.addEventListener('change', showProfile); action.addEventListener('change', showKey);
  keyButton.addEventListener('click', () => { capture = true; keyButton.textContent = t('Press a key…', 'Нажмите клавишу…'); get('settings-controls-status').textContent = ''; });
  keyButton.addEventListener('blur', () => { if (capture) { capture = false; showKey(); } });
  keyButton.addEventListener('keydown', event => {
    if (!capture) return;
    event.preventDefault(); event.stopPropagation(); capture = false;
    const message = event.code === 'Escape' ? t('Cancelled.', 'Отменено.') : stagedBindings.remap(profile.value, action.value, event.code);
    get('settings-controls-status').textContent = message || t('Key changed. Apply or save.', 'Клавиша изменена. Примените или сохраните.'); showKey();
  });
  get('settings-controls-reset').addEventListener('click', () => { stagedBindings.reset(profile.value); showKey(); get('settings-controls-status').textContent = t('Profile defaults restored in draft.', 'Клавиши профиля восстановлены в черновике.'); });
  get('settings-reset').addEventListener('click', () => { draft = { ...settingsDefaults }; audioDraft = { ...audioDefaults }; stagedBindings.overrides = {}; renderInputs(); showKey(); status.textContent = t('Defaults ready to apply.', 'Настройки по умолчанию готовы к применению.'); });
  get('settings-apply').addEventListener('click', applyDraft); get('settings-save').addEventListener('click', saveDraft);
  dialog.querySelectorAll('[data-settings-cancel]').forEach(button => button.addEventListener('click', closeSettings));
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
  dialog.addEventListener('close', () => { capture = false; });

  function showMenu() {
    if (flight.active) return;
    menu.hidden = false; shell.inert = true; updateSaveStatus();
    menu.querySelector('[data-menu-action="new"]').focus();
  }
  function leaveMenu() { menu.hidden = true; shell.inert = false; window.dispatchEvent(new Event('resize')); }
  get('open-main-menu').addEventListener('click', showMenu);
  menu.addEventListener('keydown', event => {
    if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
    const available = menuButtons.filter(button => !button.disabled), index = available.indexOf(document.activeElement);
    if (index < 0) return; event.preventDefault(); available[(index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length].focus();
  });
  menu.addEventListener('click', async event => {
    const button = event.target.closest('[data-menu-action]'); if (!button || button.disabled) return;
    const id = button.dataset.menuAction;
    if (id === 'settings') return openSettings();
    if (id === 'credits') { credits.showModal(); return; }
    if (id === 'missions') { missionDialog.showModal(); return; }
    if (id === 'exit') {
      if (window.jugreDesktop?.exit) window.jugreDesktop.exit();
      else saveStatus.textContent = t('Close this browser tab to exit.', 'Закройте вкладку браузера, чтобы выйти.');
      return;
    }
    if (id === 'continue') {
      button.disabled = true; saveStatus.textContent = t('RESTORING FLIGHT…', 'ВОССТАНОВЛЕНИЕ ПОЛЁТА…');
      try { leaveMenu(); selectView('launch', true); await flight.resumeCheckpoint(); }
      catch (error) { showMenu(); saveStatus.textContent = `${t('COULD NOT RESUME', 'НЕ УДАЛОСЬ ПРОДОЛЖИТЬ')}: ${error.message}`; }
      finally { updateContinueAfterAttempt(); }
      return;
    }
    leaveMenu();
    if (id === 'assembly') { selectView('rocket', true); document.querySelector('[data-view="rocket"]').focus(); }
    if (id === 'new') { selectView('rocket', true); standard.open(); }
    if (id === 'projects') { selectView('rocket', true); standard.openProjects(); }
  });
  function updateContinueAfterAttempt() { menu.querySelector('[data-menu-action="continue"]').disabled = !flight.hasCheckpoint(); }
  get('credits-close').addEventListener('click', () => credits.close());
  get('missions-close').addEventListener('click', () => missionDialog.close());
  get('mission-historical').addEventListener('click', () => { missionDialog.close(); leaveMenu(); selectView('launch', true); get('mission-details').open = true; get('launch-rocket').focus(); });
  get('mission-custom').addEventListener('click', () => { missionDialog.close(); leaveMenu(); selectView('rocket', true); standard.openProjects(); });
  shell.inert = true;
  applyRuntime(applied); translate();
  for (const button of menuButtons) if (button.dataset.menuAction !== 'continue') button.disabled = false;
  updateSaveStatus();
  menu.querySelector('[data-menu-action="new"]').focus();
  return { get visible() { return !menu.hidden; } };
}
