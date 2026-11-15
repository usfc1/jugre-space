const { app, BrowserWindow, Menu, dialog, shell, protocol, net, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const smoke = process.argv.includes('--smoke-test');
const menuTest = process.argv.includes('--menu-test');
const isolated = smoke || menuTest;
const build = require('./build-info.json');
app.setName('JUGRE Space Project Test');
app.setAppUserModelId('space.jugre.testing');
protocol.registerSchemesAsPrivileged([{ scheme:'jugre', privileges:{ standard:true, secure:true, supportFetchAPI:true } }]);
const smokeDir = isolated ? path.resolve(process.env.JUGRE_SMOKE_REPORT_DIR || path.join(app.getPath('temp'), `jugre-smoke-${process.pid}`)) : null;
const userData = isolated ? path.join(smokeDir, 'profile') : path.join(app.getPath('appData'), 'JUGRE Space Project Test');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
const logs = path.join(userData, 'logs');
fs.mkdirSync(logs, { recursive: true });
app.setAppLogsPath(logs);
const logFile = path.join(logs, 'session.log');
function rotateLog() {
  const previous = path.join(logs, 'previous-session.log');
  fs.rmSync(previous, { force:true });
  fs.renameSync(logFile, previous);
}
try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) rotateLog(); } catch { /* Optional log history. */ }
let logBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
function log(type, value) {
  try {
    const line = `${new Date().toISOString()} [${type}] ${String(value).slice(0, 6000)}\n`;
    if (logBytes > 2 * 1024 * 1024) { rotateLog(); logBytes=0; }
    fs.appendFileSync(logFile,line); logBytes+=Buffer.byteLength(line);
  } catch { /* Logging must not stop a flight. */ }
}
let window;
const game = app.isPackaged ? path.join(__dirname, 'game', 'index.html') : path.resolve(__dirname, '..', 'assembly_hangar', 'index.html');
// A fixed origin keeps saves stable when the portable launcher extracts to a
// different temporary directory. Serve only the packaged game at this origin.
const gameURL = 'jugre://game/index.html';
function fatal(error) {
  log('fatal', error.stack || error);
  if (!smoke) dialog.showErrorBox('JUGRE · Ошибка приложения', `Не удалось продолжить работу.\n\n${error.message || error}\n\nЖурнал: ${logFile}`);
  app.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
app.on('window-all-closed', () => app.quit());
if (!isolated && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    protocol.handle('jugre', request => request.url.split('#')[0] === gameURL
      ? net.fetch(pathToFileURL(game).href) : new Response(null, { status:404 }));
    log('start', JSON.stringify({ build, arch: process.arch, platform: process.platform, gpu: app.getGPUFeatureStatus() }));
    window = new BrowserWindow({
      title: `JUGRE Space Project · Test ${build.version}`, width: 1440, height: 900,
      minWidth: 1024, minHeight: 700, backgroundColor: '#0d151c', show: false,
      icon: path.join(__dirname, 'resources', 'icon.ico'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: !isolated, webgl: true, devTools: true, spellcheck: false },
    });
    ipcMain.on('jugre:exit', event => { if (event.sender === window?.webContents && event.senderFrame?.url === gameURL) app.quit(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== gameURL) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('console-message', details => {
      if (details.level === 'error' || details.level === 'warning') log('renderer', details.message);
    });
    window.webContents.on('render-process-gone', (_event, details) => log('renderer-exit', JSON.stringify(details)));
    window.webContents.on('unresponsive', () => log('unresponsive', 'Renderer stopped responding'));
    window.webContents.on('did-fail-load', (_event, code, description, url, main) => {
      if (main && code !== -3) fatal(new Error(`Не загрузилась игра (${code}): ${description} ${url}`));
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Игра', submenu: [
        { label: 'Перезагрузить игру', accelerator: 'Ctrl+R', click: () => window.reload() },
        { label: 'Полный экран', accelerator: 'F11', click: () => window.setFullScreen(!window.isFullScreen()) },
        { type: 'separator' }, { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ] },
      { label: 'Тестирование', submenu: [
        { label: 'Папка журналов', click: () => shell.openPath(logs) },
        { label: 'Консоль разработчика', accelerator: 'F12', click: () => window.webContents.toggleDevTools() },
        { label: 'О тестовой сборке', click: () => dialog.showMessageBox(window, { type: 'info', title: 'JUGRE · Test build',
          message: `JUGRE Space Project ${build.version}`, detail: `Windows x64 · автономная сборка\n${build.builtAt}\nSHA-256 игры: ${build.gameSHA256}\n\nСохранения и журналы:\n${userData}\n\nF11 — полный экран; F12 — консоль.` }) },
      ] },
    ]));
    if (!isolated) window.once('ready-to-show', () => { window.maximize(); window.show(); });
    await window.loadURL(gameURL);
    if (smoke) {
      const run = require('./smoke-test.cjs');
      try {
        await run(window, smokeDir, build);
        log('smoke', 'PASS'); app.exit(0);
      } catch (error) {
        fs.mkdirSync(smokeDir, { recursive: true });
        fs.writeFileSync(path.join(smokeDir, 'result.json'), JSON.stringify({ passed:false, error:error.stack || String(error), build }, null, 2));
        log('smoke-failed', error.stack); app.exit(1);
      }
    }
  }).catch(fatal);
}
