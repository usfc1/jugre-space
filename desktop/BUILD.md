# Windows portable build

From this directory on Windows with Node.js installed:

```powershell
npm ci --no-audit --no-fund
npm run build:win
npm run test:exe
```

The game is packaged from `../assembly_hangar/index.html`; rebuild that bundle
first after changing game source. The output is a single portable x64 executable
in `../release`, including Chromium and all game assets. It needs no installer
or network connection. This testing build is unsigned.

`build-info.json` records the version, build time and SHA-256 of the packaged
game. `test:exe` starts the actual portable executable with an isolated profile
and checks the WebGL scene, HUD, HOLD, saving/restoring physics state, abort,
return to the pad and save persistence across two launches with different
temporary extraction directories. Its reports and screenshots are in
`../release/verification`.

For a visible rendering check, close any running copy and run
`node test-visible.cjs` (uses Playwright from `assembly_hangar/source`). This
starts the actual portable EXE normally, verifies nonuniform WebGL geometry,
exercises the controls, captures `visible-flight.png`, and closes the app.

The builder normally downloads Electron itself. To reuse a manually downloaded
distribution, put `electron-v45.2.3-win32-x64.zip` in `.cache`, or set
`JUGRE_ELECTRON_DIST` to its path. The build verifies its SHA-256 against the
checksums in the official matching Electron npm package before using it.

Testers need only the final `.exe`. Instructions are in
`../release/README_TESTERS.txt`. User data and capped error logs are stored under
`%APPDATA%\JUGRE Space Project Test`, outside the portable extraction directory.

# SI development launch

On this machine, run `start-si.cmd` to open the current source build with the
existing local Electron runtime. SI is available without a sign-in. The previous
portable executable is not changed by this launcher.

Run `start-web.cmd` to serve the same game locally at
`http://127.0.0.1:4179/`. Keep the server window open while playing. SI sends
requests to Cloudflare without including the API key in the browser.
