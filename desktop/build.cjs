const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('./package.json');
const root = path.resolve(__dirname, '..');
const game = path.join(root, 'assembly_hangar', 'index.html');
if (!fs.existsSync(game)) throw new Error('Build assembly_hangar/source first: npm run build');
const bytes = fs.readFileSync(game);
if (!bytes.includes(Buffer.from('PHYSICAL FLIGHT'))) throw new Error('The game bundle does not contain the updated flight HUD');
const gameSHA256 = crypto.createHash('sha256').update(bytes).digest('hex');
// A pre-downloaded distribution is useful on slow networks. Always validate it
// against the checksums shipped by the matching official Electron npm package.
const cachedElectron = process.env.JUGRE_ELECTRON_DIST || path.join(__dirname, '.cache', `electron-v${pkg.devDependencies.electron}-win32-x64.zip`);
let electronDist;
if (fs.existsSync(cachedElectron)) {
  const expected = require('electron/checksums.json')[`electron-v${pkg.devDependencies.electron}-win32-x64.zip`];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(cachedElectron)).digest('hex');
  if (!expected || actual !== expected) throw new Error(`Electron distribution checksum mismatch: ${cachedElectron}`);
  electronDist = path.resolve(cachedElectron);
}
fs.writeFileSync(path.join(__dirname, 'build-info.json'), JSON.stringify({
  name: pkg.build.productName, version: pkg.version, builtAt: new Date().toISOString(),
  platform: 'win32-x64', electron: pkg.devDependencies.electron,
  gameBytes: bytes.length, gameSHA256,
}, null, 2));
build({ projectDir: __dirname, targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
  config: { ...pkg.build, electronVersion: pkg.devDependencies.electron, ...(electronDist ? { electronDist } : {}),
    ...(process.env.JUGRE_BUILD_OUTPUT ? { directories: { ...pkg.build.directories, output: path.resolve(process.env.JUGRE_BUILD_OUTPUT) } } : {}),
    afterPack: async context => {
      const packaged = require('@electron/asar').extractFile(path.join(context.appOutDir, 'resources', 'app.asar'), 'game/index.html');
      if (crypto.createHash('sha256').update(packaged).digest('hex') !== gameSHA256) throw new Error('Packaged game is missing or differs from the verified source bundle');
      console.log(`Verified packaged game: ${packaged.length} bytes, SHA-256 ${gameSHA256}`);
    },
  }, publish: 'never',
}).then(outputs => console.log('Windows build:', outputs.join('\n'))).catch(error => { console.error(error); process.exitCode = 1; });
