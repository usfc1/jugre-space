const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jugre-physx-electron-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show:false, width:1440, height:900,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false} });
  const errors=[];
  window.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  const evaluate = source => window.webContents.executeJavaScript(source, true);
  async function until(source) {
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){const result=await evaluate(source);if(result)return result;await wait(150);}
    throw new Error('Electron check timed out: '+source+' '+errors.join('\n'));
  }
  try {
    await window.loadURL(pathToFileURL(path.join(__dirname,'..','assembly_hangar','index.html')).href);
    await until('document.querySelector("#loading")?.hidden');
    await evaluate('document.querySelector("[data-view=launch]").click(); const select=document.querySelector("#launch-rocket"); select.value="apollo_11"; select.dispatchEvent(new Event("change"));');
    await until('!document.querySelector("#flight-start").disabled');
    await evaluate('document.querySelector("#flight-start").click()');
    await until('!document.querySelector("#flight-panel").hidden');
    await evaluate('document.querySelector("#flight-diagnostics").open=true');
    const snapshot=await until('JSON.parse(document.querySelector(".physics-values").dataset.snapshot||"null")');
    if(!snapshot.rendering.rigid?.loaded)throw new Error('PhysX did not initialize in Electron');
    const game=fs.readFileSync(path.join(__dirname,'..','assembly_hangar','index.html'));
    const report={checkedAt:new Date().toISOString(),gameSHA256:crypto.createHash('sha256').update(game).digest('hex'),
      electron:process.versions.electron,chrome:process.versions.chrome,backend:snapshot.rendering.rigid,errors};
    fs.writeFileSync(path.join(__dirname,'..','assembly_hangar','diagnostics','physx','electron-verification.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    if(errors.length)throw new Error(errors.join('\n'));
    app.exit(0);
  } catch(error) { console.error(error);app.exit(1); }
});
