// Campus Conveyance for Windows, Mac and Linux (owner, 2026-11-13 — the same pattern as the Aevidine desktop app,
// 3D_BACKUP desktop/aevidine). A window around the live site: a website release reaches this app at once; this shell
// changes only when a desktop feature does. Electron carries Chrome's engine, so the site behaves as in Chrome.
//
// What the shell adds:
//   · one window, remembered size; a second launch focuses it
//   · only our site opens inside; any other address opens in the normal browser
//   · Google sign-in in the normal browser (Google refuses embedded windows): the sign-in request is sent there with
//     the return address campusconveyance://auth/callback — the one the Android app already uses, allow-listed in
//     Supabase — and the code comes back here, where this window (which holds the sign-in's PKCE secret) finishes it
//     on the site's own /auth/callback
//   · downloads straight to Downloads; "Update now" from the public binaries repo aevinite/campus-apps
"use strict";
const { app, BrowserWindow, Menu, Notification, dialog, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SITE = (process.env.CC_SITE || "https://campus-conveyance-live.vercel.app").replace(/\/+$/, "");
const SITE_ORIGIN = new URL(SITE).origin;
const SCHEME = "campusconveyance";
const NATIVE_REDIRECT = `${SCHEME}://auth/callback`;

let win = null;
let pending = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${SCHEME}://`));
    if (link) handleLink(link);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}
app.on("open-url", (e, url) => { e.preventDefault(); handleLink(url); });
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(SCHEME);

let signInStarted = 0; // a callback is honoured only shortly after THIS window started a Google sign-in
function handleLink(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== "auth") return;
  if (!win) { pending = url; return; }
  if (u.pathname === "/callback") {
    if (Date.now() - signInStarted > 10 * 60 * 1000) return;
    signInStarted = 0;
    // The site's own callback exchanges the code with the PKCE secret this window's cookies hold.
    win.loadURL(`${SITE}/auth/callback?${u.searchParams.toString()}`);
  } else if (u.pathname === "/confirm") {
    win.loadURL(`${SITE}/login?confirmed=1`);
  }
  win.focus();
}

const STATE_FILE = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); } catch { return {}; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch { /* next time */ }
}
const ours = (url) => { try { return new URL(url).origin === SITE_ORIGIN; } catch { return false; } };

/** A Google sign-in request (Supabase's /auth/v1/authorize?provider=google): send it to the browser with the app's return address. */
function googleSignIn(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/\.supabase\.co$/.test(u.hostname) || u.pathname !== "/auth/v1/authorize" || u.searchParams.get("provider") !== "google") return false;
  u.searchParams.set("redirect_to", NATIVE_REDIRECT);
  signInStarted = Date.now();
  shell.openExternal(u.toString());
  return true;
}

function openOutside(url) {
  try { const u = new URL(url); if (["https:", "http:", "mailto:", "tel:"].includes(u.protocol)) shell.openExternal(url); } catch { /* not an address */ }
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 820, x: st.x, y: st.y, minWidth: 360, minHeight: 500,
    title: "Campus Conveyance", backgroundColor: "#ffffff", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveState);
  win.on("closed", () => { win = null; });
  const wc = win.webContents;
  wc.on("will-navigate", (e, url) => {
    if (ours(url)) return;
    e.preventDefault();
    if (!googleSignIn(url)) openOutside(url);
  });
  wc.on("will-redirect", (e, url) => {
    if (ours(url)) return;
    if (googleSignIn(url)) e.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || ours(url)) return { action: "allow", overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true } };
    if (!googleSignIn(url)) openOutside(url);
    return { action: "deny" };
  });
  wc.on("did-fail-load", (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3) wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(url))}`);
  });
  win.loadURL(`${SITE}/login`, { userAgent: `${wc.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ campus-conveyance-desktop\/\S+/, "")} CampusDesktop/${app.getVersion()}` });
  if (pending) { const l = pending; pending = null; wc.once("did-finish-load", () => handleLink(l)); }
}

function offlinePage(url) {
  const safe = String(url).replace(/[<>"&']/g, "");
  return `<!doctype html><meta charset="utf-8"><title>Campus Conveyance</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#111;font:16px/1.5 system-ui,sans-serif"><main style="max-width:420px;padding:24px;text-align:center"><h2 style="margin:0 0 8px">No internet</h2><p style="opacity:.75">Campus Conveyance couldn't connect. Check the Wi-Fi or cable, then try again.</p><button onclick="location.href='${safe}'" style="border:0;border-radius:10px;padding:10px 18px;font:600 15px system-ui;background:#111;color:#fff">Try again</button></main>`;
}

function setupDownloads() {
  session.defaultSession.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    const name = item.getFilename() || "download";
    const ext = path.extname(name), base = path.basename(name, ext);
    let target = path.join(dir, name), n = 1;
    while (fs.existsSync(target)) target = path.join(dir, `${base} (${n++})${ext}`);
    item.setSavePath(target);
    item.once("done", (_ev, state) => {
      if (state !== "completed") return;
      const note = new Notification({ title: "Saved to Downloads", body: path.basename(target) });
      note.on("click", () => shell.showItemInFolder(target));
      note.show();
    });
  });
}

function setupMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ label: "Print…", accelerator: "CmdOrCtrl+P", click: () => win && win.webContents.print({}) }, { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [{ label: "Check for updates", click: () => checkForUpdates(true) }, { label: "Campus Conveyance website", click: () => shell.openExternal("https://campusconveyance.aevinite.com") }] },
  ]));
}

const newer = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
};
const selfUpdating = () => !process.windowsStore && (process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE));
async function checkForUpdates(byHand) {
  if (!app.isPackaged) { if (byHand) dialog.showMessageBox(win, { message: "Updates are checked only in the installed app." }); return; }
  if (process.windowsStore) { if (byHand) dialog.showMessageBox(win, { message: "The Microsoft Store keeps the app up to date by itself." }); return; }
  if (selfUpdating()) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.once("update-downloaded", async (info) => {
        const r = await dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0, message: `Campus Conveyance ${info.version} is ready.`, detail: "Restart to finish updating." });
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
      const res = await autoUpdater.checkForUpdates();
      if (byHand && (!res || !res.isUpdateAvailable)) dialog.showMessageBox(win, { message: "Campus Conveyance is up to date." });
    } catch { if (byHand) dialog.showMessageBox(win, { message: "Couldn't check for updates. Check the internet and try again." }); }
    return;
  }
  try {
    const j = await (await fetch(`${SITE}/app/latest.json`, { cache: "no-store" })).json();
    const plat = process.platform === "darwin" ? j.mac : j.linux;
    if (plat && plat.version && newer(plat.version, app.getVersion())) {
      const link = process.platform === "darwin" ? (process.arch === "arm64" ? plat.dmg : plat.dmgIntel || plat.dmg) : plat.deb || plat.appimage;
      const res = await dialog.showMessageBox(win, { type: "info", buttons: ["Update now", "Later"], defaultId: 0, message: `Campus Conveyance ${plat.version} is out.`,
        detail: process.platform === "darwin" ? "Update now downloads it. Open the file and drag the app into Applications, replacing the old one." : "Update now downloads the new version." });
      if (res.response === 0 && link) shell.openExternal(link);
    } else if (byHand) dialog.showMessageBox(win, { message: "Campus Conveyance is up to date." });
  } catch { if (byHand) dialog.showMessageBox(win, { message: "Couldn't check for updates. Check the internet and try again." }); }
}

app.whenReady().then(() => {
  setupDownloads();
  setupMenu();
  createWindow();
  const link = process.argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (link) handleLink(link);
  setTimeout(() => checkForUpdates(false), 20_000);
  setInterval(() => checkForUpdates(false), 6 * 3600 * 1000);
  app.on("activate", () => { if (!win) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
