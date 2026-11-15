const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const pkg = require('./package.json');
const file = path.resolve(__dirname, '..', 'release', `JUGRE-Space-Project-${pkg.version}-win-x64.exe`);
const report = path.resolve(__dirname, '..', 'release', 'verification');
const expectedGameSHA256 = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..','assembly_hangar','index.html'))).digest('hex');
if (!fs.existsSync(file)) throw new Error('Run npm run build:win first');
fs.mkdirSync(report, { recursive:true });

function launch(expectSave) {
  fs.rmSync(path.join(report,'result.json'), { force:true });
  const env = { ...process.env, JUGRE_SMOKE_REPORT_DIR:report, JUGRE_SMOKE_EXPECT_SAVE:expectSave ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(file, ['--smoke-test'], { env, windowsHide:true, stdio:'pipe' });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    const timeout = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
      else child.kill();
      reject(new Error('Packaged app test timed out'));
    }, 180000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => {
      clearTimeout(timeout);
      try {
        const resultFile = path.join(report,'result.json');
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile,'utf8')) : null;
        if (code !== 0 || !result?.passed || !result.packaged) throw new Error(JSON.stringify(result || `App exited ${code} without a test report`));
        if(result.build?.gameSHA256!==expectedGameSHA256)throw new Error('Portable EXE contains an outdated game bundle');
        console.log(`PASS: actual portable EXE — ${result.checks.join(', ')}`);
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}
(async () => {
  const first = await launch(false);
  const restarted = await launch(true);
  fs.writeFileSync(path.join(report,'runs.json'), JSON.stringify({ first, restarted }, null, 2));
})().catch(error => { console.error(error); process.exitCode=1; });
