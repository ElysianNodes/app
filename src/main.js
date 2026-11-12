'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  dialog,
  ipcMain,
  shell,
  Menu,
  session,
  clipboard,
  screen
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const DiscordRPC = require('discord-rpc');
const { autoUpdater } = require('electron-updater');
const scrypt = promisify(crypto.scrypt);

const UPDATE_SUPPORTED = process.platform === 'win32' && app.isPackaged;
let updateState = {
  status: 'idle',
  message: 'Updates are checked automatically when ElysianNodes starts.',
  version: null,
  percent: 0,
  supported: UPDATE_SUPPORTED
};

function publishUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  if (uiContents && !uiContents.isDestroyed()) uiContents.send('updates:status', updateState);
}

function configureAutoUpdater() {
  if (!UPDATE_SUPPORTED) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => publishUpdateState({
    status: 'checking', message: 'Checking for updates…', percent: 0
  }));
  autoUpdater.on('update-available', (info) => publishUpdateState({
    status: 'available',
    message: `Version ${info.version} is available.`,
    version: info.version,
    percent: 0
  }));
  autoUpdater.on('update-not-available', (info) => publishUpdateState({
    status: 'current',
    message: `ElysianNodes is up to date${info.version ? ` (v${info.version})` : ''}.`,
    version: info.version || null,
    percent: 0
  }));
  autoUpdater.on('download-progress', (progress) => publishUpdateState({
    status: 'downloading',
    message: `Downloading update… ${Math.round(progress.percent)}%`,
    percent: Math.max(0, Math.min(100, Math.round(progress.percent)))
  }));
  autoUpdater.on('update-downloaded', (info) => publishUpdateState({
    status: 'downloaded',
    message: `Version ${info.version} is ready to install.`,
    version: info.version,
    percent: 100
  }));
  autoUpdater.on('error', (error) => {
    console.warn('[Updater] Update check failed:', error && error.message);
    publishUpdateState({ status: 'error', message: 'Could not check for updates. Try again later.' });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

const DISCORD_CLIENT_ID = '957540452142313472';
const DISCORD_RPC_RETRY_MS = 15000;
let discordClient = null;
let discordRetryTimer = null;
let discordReady = false;
let discordStatus = 'Discord is not connected';

// Bot checks such as Cloudflare Turnstile run inside out-of-process iframes,
// which do not inherit `session.setUserAgent()`. Set a clean Chrome user agent
// app-wide so those frames are not identified as an unsupported Electron build.
const PLATFORM_UA =
  process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Windows NT 10.0; Win64; x64';
app.userAgentFallback =
  `Mozilla/5.0 (${PLATFORM_UA}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome} Safari/537.36`;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVICES = [
  {
    id: 'billing',
    label: 'Billing Area',
    url: 'https://billing.elysiannodes.uk/',
    partition: 'persist:elysian-billing'
  },
  {
    id: 'panel',
    label: 'Game Panel',
    url: 'https://control.elysiannodes.uk/',
    partition: 'persist:elysian-panel'
  },
  {
    id: 'webhosting',
    label: 'Webhosting Panel',
    url: 'https://cp.elysiannodes.uk:8083/',
    partition: 'persist:elysian-webhosting'
  }
];

const WINDOW_BACKGROUND = '#050507';
const VIEW_BACKGROUND = '#0a0a0d';
const DEFAULT_EMBED_INSETS = { left: 15, top: 155, right: 15, bottom: 15 };
const DEFAULT_EMBED_RADIUS = 19;
const BILLING_WIDTH_WARNING_THRESHOLD = 1137;
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock'
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mainWindow = null;
let uiContents = null;
let views = [];
let tabStates = [];
let activeTab = 0;
let appPage = null;
let embedInsets = { ...DEFAULT_EMBED_INSETS };
let embedRadius = DEFAULT_EMBED_RADIUS;
let saveTimer = null;
let passcodeRecord = null;
let passcodeConfigured = false;
let isLocked = false;
let passcodeFailures = 0;
let passcodeLockoutUntil = 0;
let billingWidthWarningOpen = false;
let billingWidthWarningSuppressed = false;

let store = {
  activeTab: 0,
  maximized: false,
  bounds: null,
  autoStart: true,
  startMinimized: false,
  neverRemindBillingWidth: false
};

const serviceSessions = new Set();

const storePath = () => path.join(app.getPath('userData'), 'window-state.json');
const discordCredentialsPath = () => path.join(app.getPath('userData'), 'discord-rpc.enc');
const passcodePath = () => path.join(app.getPath('userData'), 'passcode.json');

function readPasscode() {
  try {
    const filePath = passcodePath();
    if (!fs.existsSync(filePath)) return;
    passcodeConfigured = true;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && typeof raw.salt === 'string' && typeof raw.hash === 'string') {
      passcodeRecord = raw;
    }
    isLocked = true;
    appPage = 'passcode';
  } catch {
    // Keep the app locked if the credential file exists but cannot be read.
    passcodeConfigured = true;
    isLocked = true;
    appPage = 'passcode';
  }
}

async function verifyPasscode(value) {
  if (!passcodeRecord || typeof value !== 'string') return false;
  const candidate = await scrypt(value, passcodeRecord.salt, 64);
  const expected = Buffer.from(passcodeRecord.hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

async function checkPasscode(value) {
  const remaining = passcodeLockoutUntil - Date.now();
  if (remaining > 0) return { ok: false, retryAfterMs: remaining };
  let valid = false;
  try { valid = await verifyPasscode(value); } catch { valid = false; }
  if (!valid) {
    passcodeFailures += 1;
    if (passcodeFailures >= 5) {
      passcodeFailures = 0;
      passcodeLockoutUntil = Date.now() + 30000;
    }
    return { ok: false, retryAfterMs: Math.max(0, passcodeLockoutUntil - Date.now()) };
  }
  passcodeFailures = 0;
  passcodeLockoutUntil = 0;
  return { ok: true };
}

function logDiscordRPC(message, error) {
  const line = `${new Date().toISOString()} ${message}${error ? `: ${error.message || error}` : ''}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'discord-rpc.log'), line);
  } catch {
    /* diagnostics are best-effort */
  }
}

function logSettingsDiagnostic(message) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'settings-debug.log'),
      `${new Date().toISOString()} ${message}\n`
    );
  } catch {
    /* diagnostics are best-effort */
  }
}

function setDiscordStatus(status) {
  discordStatus = status;
  if (uiContents && !uiContents.isDestroyed()) uiContents.send('discord:status', status);
}

// ---------------------------------------------------------------------------
// Persisted window state
// ---------------------------------------------------------------------------

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (raw && typeof raw === 'object') {
      store.activeTab = Number.isInteger(raw.activeTab) ? raw.activeTab : 0;
      store.maximized = raw.maximized === true;
      store.autoStart = raw.autoStart !== false;
      store.startMinimized = raw.startMinimized === true;
      store.neverRemindBillingWidth = raw.neverRemindBillingWidth === true;
      if (
        raw.bounds &&
        ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(raw.bounds[key]))
      ) {
        store.bounds = raw.bounds;
      }
      return true;
    }
  } catch {
    /* first run or unreadable state - fall back to defaults */
  }
  return false;
}

function writeStore() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    let bounds = store.bounds;
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen() && !mainWindow.isMinimized()) {
      bounds = mainWindow.getBounds();
      store.bounds = bounds;
    }
    const data = {
      activeTab,
      maximized: mainWindow.isMaximized(),
      bounds,
      autoStart: store.autoStart,
      startMinimized: store.startMinimized,
      neverRemindBillingWidth: store.neverRemindBillingWidth
    };
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(data, null, 2));
  } catch {
    /* state persistence is best-effort */
  }
}

function applyAutoStart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: store.autoStart,
      path: process.execPath,
      name: 'uk.elysiannodes.hub',
      args: store.startMinimized ? ['--start-minimized'] : [],
      enabled: true
    });
  } catch {
    /* Login item settings may be unavailable in development. */
  }
}

function getAutoStartEnabled() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
  try {
    const settings = app.getLoginItemSettings();
    if (process.platform === 'win32' && Array.isArray(settings.launchItems)) {
      const currentPath = path.resolve(process.execPath).toLowerCase();
      const matches = settings.launchItems.filter((item) => {
        if (!item.path) return false;
        return path.resolve(String(item.path).replace(/^"|"$/g, '')).toLowerCase() === currentPath;
      });
      if (matches.length) return matches.some((item) => item.enabled === true);
    }
    return Boolean(settings.openAtLogin);
  } catch {
    return Boolean(store.autoStart);
  }
}

function queueStoreWrite() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeStore, 400);
}

function isOnScreen(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activeView() {
  return views[activeTab] || null;
}

function activeWebContents() {
  if (isLocked) return null;
  const view = activeView();
  if (!view || view.webContents.isDestroyed()) return null;
  return view.webContents;
}

function recently(url) {
  return /^https?:\/\//i.test(url || '');
}

function isSftpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'sftp:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function openSftpUrl(url) {
  if (!isSftpUrl(url)) return;
  shell.openExternal(url).catch(() => {
    /* No SFTP handler is installed on this computer. */
  });
}

function buildState() {
  return {
    activeTab,
    maximized: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
    fullScreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()),
    tabs: tabStates.map((tab) => ({ ...tab, error: tab.error ? { ...tab.error } : null }))
  };
}

function sendState() {
  if (!uiContents || uiContents.isDestroyed()) return;
  uiContents.send('state:update', buildState());
}

function refreshNavigationState(index) {
  const view = views[index];
  if (!view || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  const state = tabStates[index];
  try {
    state.canGoBack = wc.navigationHistory.canGoBack();
    state.canGoForward = wc.navigationHistory.canGoForward();
  } catch {
    state.canGoBack = false;
    state.canGoForward = false;
  }
  state.secure = String(state.url || '').startsWith('https://');
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = tabStates[activeTab];
  const title = state && state.title ? state.title : 'ElysianNodes';
  mainWindow.setTitle(`${title} — ElysianNodes`);
}

function updateDiscordPresence() {
  if (!discordReady || !discordClient) return;
  const active = tabStates[activeTab];
  if (!active) return;
  discordClient.setActivity({
    details: `Using ${active.label}`,
    state: 'ElysianNodes Hub',
    type: 0,
    instance: false
  }).then(() => setDiscordStatus(`Connected — ${active.label}`)).catch((error) => {
    logDiscordRPC('Discord rejected the activity update', error);
    setDiscordStatus(`Discord rejected the activity: ${error.message || error}`);
  });
}

function connectDiscordRPC() {
  if (discordClient || app.isQuitting) return;

  try {
    const client = new DiscordRPC.Client({ transport: 'ipc' });
    discordClient = client;

    client.on('ready', () => {
      if (discordClient !== client) return;
      discordReady = true;
      setDiscordStatus('Connected to Discord; publishing activity.');
      logDiscordRPC('Discord RPC connected');
      updateDiscordPresence();
    });
    client.on('disconnected', () => {
      if (discordClient !== client) return;
      discordReady = false;
      discordClient = null;
      setDiscordStatus('Discord disconnected; retrying.');
      scheduleDiscordRetry();
    });
    client.on('error', (error) => logDiscordRPC('Discord RPC client error', error));

    setDiscordStatus('Connecting to Discord…');
    client.login({ clientId: DISCORD_CLIENT_ID }).catch((error) => handleDiscordLoginFailure(client, error));
  } catch (error) {
    logDiscordRPC('Could not start Discord RPC', error);
    discordClient = null;
    setDiscordStatus(`Could not start Discord RPC: ${error.message || error}`);
    scheduleDiscordRetry();
  }
}

function handleDiscordLoginFailure(client, error) {
  if (discordClient !== client) return;
  discordReady = false;
  discordClient = null;
  logDiscordRPC('Discord RPC connection failed', error);
  const detail = error && (error.message || error.code);
  setDiscordStatus(`Discord connection failed: ${detail || 'check discord-rpc.log'}`);
  try { client.destroy().catch(() => {}); } catch {}
  scheduleDiscordRetry();
}

function scheduleDiscordRetry() {
  if (discordRetryTimer || app.isQuitting) return;
  discordRetryTimer = setTimeout(() => {
    discordRetryTimer = null;
    connectDiscordRPC();
  }, DISCORD_RPC_RETRY_MS);
  discordRetryTimer.unref?.();
}

function disconnectDiscordRPC() {
  clearTimeout(discordRetryTimer);
  discordRetryTimer = null;
  const client = discordClient;
  discordClient = null;
  discordReady = false;
  if (!client) return;
  try { client.clearActivity().catch(() => {}); } catch {}
  try { client.destroy().catch(() => {}); } catch {}
}

function syncViewVisibility(index) {
  const view = views[index];
  if (!view || view.webContents.isDestroyed()) return;
  const state = tabStates[index];
  const visible = appPage === null && index === activeTab && !state.error;
  view.setVisible(visible);
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed() || views.length === 0) return;
  const [width, height] = mainWindow.getContentSize();
  const { left, top, right, bottom } = embedInsets;
  const bounds = appPage === null ? {
    x: Math.max(0, Math.min(left, width)),
    y: Math.max(0, Math.min(top, height)),
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - top - bottom)
  } : { x: 0, y: 0, width: 0, height: 0 };
  for (const view of views) {
    if (view.webContents.isDestroyed()) continue;
    view.setBounds(bounds);
    view.setBorderRadius(embedRadius);
  }
}

function maybeWarnBillingWidth() {
  const eligible = mainWindow && !mainWindow.isDestroyed() && !isLocked &&
    appPage === null && activeTab === 0 &&
    mainWindow.getBounds().width < BILLING_WIDTH_WARNING_THRESHOLD;
  if (!eligible) {
    billingWidthWarningSuppressed = false;
    return;
  }
  if (store.neverRemindBillingWidth || billingWidthWarningOpen || billingWidthWarningSuppressed) return;

  billingWidthWarningSuppressed = true;
  billingWidthWarningOpen = true;
  dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Billing Area window is narrow',
    message: 'The Billing Area may not work perfectly when the app window is under 1137 pixels wide.',
    detail: 'Make the window wider for the best experience.',
    buttons: ['OK', 'Never remind me again'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }).then(({ response }) => {
    if (response === 1) {
      store.neverRemindBillingWidth = true;
      writeStore();
    }
  }).catch(() => {}).finally(() => {
    billingWidthWarningOpen = false;
    if (mainWindow && !mainWindow.isDestroyed() &&
      (appPage !== null || activeTab !== 0 || mainWindow.getBounds().width >= BILLING_WIDTH_WARNING_THRESHOLD)) {
      billingWidthWarningSuppressed = false;
    }
  });
}

function activateTab(index) {
  if (isLocked) return;
  if (!mainWindow || mainWindow.isDestroyed() || views.length === 0) return;
  const next = Math.max(0, Math.min(index, views.length - 1));
  activeTab = next;

  views.forEach((view, i) => {
    if (!view.webContents.isDestroyed()) {
      view.setVisible(i === activeTab && !tabStates[i].error);
    }
  });

  layoutViews();

  const view = views[activeTab];
  if (!tabStates[activeTab].error && view && !view.webContents.isDestroyed()) {
    view.webContents.focus();
  }

  updateWindowTitle();
  updateDiscordPresence();
  queueStoreWrite();
  sendState();
  maybeWarnBillingWidth();
}

// ---------------------------------------------------------------------------
// Embedded services
// ---------------------------------------------------------------------------

function configureSessions() {
  for (const service of SERVICES) {
    const ses = session.fromPartition(service.partition);
    serviceSessions.add(ses);

    // Present as a regular browser rather than Electron so that dashboards and
    // login providers do not flag the client as an unsupported browser.
    const ua = ses
      .getUserAgent()
      .replace(/\sElectron\/[\d.]+/gi, '')
      .replace(/\selysiannodes-hub\/[\d.]+/gi, '')
      .replace(/\sElysianNodes\/[\d.]+/gi, '');
    ses.setUserAgent(ua);

    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  }
}

function attachViewEvents(wc, index) {
  const state = tabStates[index];

  wc.on('did-start-loading', () => {
    state.loading = true;
    state.error = null;
    refreshNavigationState(index);
    syncViewVisibility(index);
    sendState();
  });

  wc.on('did-stop-loading', () => {
    state.loading = false;
    refreshNavigationState(index);
    sendState();
  });

  wc.on('did-finish-load', () => {
    state.loading = false;
    refreshNavigationState(index);
    sendState();
  });

  wc.on('did-navigate', (_event, url) => {
    state.url = url;
    state.secure = String(url).startsWith('https://');
    state.error = null;
    refreshNavigationState(index);
    syncViewVisibility(index);
    if (index === activeTab) updateWindowTitle();
    sendState();
  });

  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    state.url = url;
    state.secure = String(url).startsWith('https://');
    refreshNavigationState(index);
    if (index === activeTab) updateWindowTitle();
    sendState();
  });

  wc.on('page-title-updated', (event, title) => {
    event.preventDefault();
    state.title = title;
    if (index === activeTab) updateWindowTitle();
    sendState();
  });

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 (ERR_ABORTED) is a normal side-effect of redirects and cancellations.
    if (!isMainFrame || errorCode === -3) return;
    state.loading = false;
    state.url = validatedURL || state.url;
    state.secure = String(state.url || '').startsWith('https://');
    state.error = {
      code: `ERR ${errorCode}`,
      description: errorDescription || 'The page could not be loaded.',
      url: validatedURL || state.url
    };
    refreshNavigationState(index);
    syncViewVisibility(index);
    sendState();
  });

  wc.on('render-process-gone', (_event, details) => {
    state.loading = false;
    state.error = {
      code: details.reason || 'CRASHED',
      description: 'The page stopped unexpectedly. Reload the tab to try again.',
      url: state.url
    };
    syncViewVisibility(index);
    sendState();
  });

  wc.on('unresponsive', () => {
    state.loading = true;
    sendState();
  });

  wc.on('responsive', () => {
    state.loading = false;
    sendState();
  });

  wc.on('before-input-event', (event, input) => {
    wireShortcut(event, input, wc);
  });
}

function wireShortcut(event, input, wc) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = String(input.key || '').toLowerCase();

  if (input.key === 'F5' || (ctrl && key === 'r')) {
    event.preventDefault();
    if (input.shift) wc.reloadIgnoringCache();
    else wc.reload();
    return;
  }

  if (input.altKey && input.key === 'ArrowLeft') {
    event.preventDefault();
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    return;
  }

  if (input.altKey && input.key === 'ArrowRight') {
    event.preventDefault();
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    return;
  }

  if (ctrl && ['1', '2', '3'].includes(input.key)) {
    event.preventDefault();
    activateTab(Number(input.key) - 1);
    return;
  }

  if (ctrl && input.key === 'Tab') {
    event.preventDefault();
    activateTab((activeTab + 1) % SERVICES.length);
    return;
  }

  if (input.key === 'F12' || (ctrl && input.shift && key === 'i')) {
    event.preventDefault();
    wc.toggleDevTools();
    return;
  }

  if (ctrl && (input.key === '=' || input.key === '+')) {
    event.preventDefault();
    wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    return;
  }

  if (ctrl && input.key === '-') {
    event.preventDefault();
    wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
    return;
  }

  if (ctrl && input.key === '0') {
    event.preventDefault();
    wc.setZoomLevel(0);
  }
}

function createViews() {
  views = SERVICES.map((service, index) => {
    const webPreferences = {
      partition: service.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    };

    if (service.id === 'panel') {
      // Match Chrome's Windows monospace default before xterm measures glyphs.
      webPreferences.defaultFontFamily = { monospace: 'Consolas' };
    }

    if (service.id === 'billing') {
      webPreferences.preload = path.join(__dirname, 'preload-billing.js');
    }

    const view = new WebContentsView({ webPreferences });

    view.setBackgroundColor(VIEW_BACKGROUND);
    mainWindow.contentView.addChildView(view);
    view.setVisible(false);

    const wc = view.webContents;
    attachViewEvents(wc, index);
    if (!isLocked) {
      wc.loadURL(service.url).catch(() => {
        /* failures surface through did-fail-load */
      });
    }

    return view;
  });
}

function loadServiceViews() {
  for (let index = 0; index < views.length; index += 1) {
    const view = views[index];
    if (!view || view.webContents.isDestroyed()) continue;
    view.webContents.loadURL(SERVICES[index].url).catch(() => {
      /* failures surface through did-fail-load */
    });
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const bounds = store.bounds && isOnScreen(store.bounds) ? store.bounds : {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1440,
    height: bounds.height || 900,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 540,
    show: false,
    frame: false,
    backgroundColor: WINDOW_BACKGROUND,
    title: 'ElysianNodes',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
      devTools: true
    }
  });

  uiContents = mainWindow.webContents;
  uiContents.on('console-message', (_event, details) => {
    if (details && String(details.message).startsWith('[SettingsDebug]')) {
      logSettingsDiagnostic(`renderer ${details.message}`);
    }
  });
  uiContents.on('preload-error', (_event, preloadPath, error) => {
    logSettingsDiagnostic(`preload error ${preloadPath}: ${error && error.message}`);
  });
  uiContents.on('render-process-gone', (_event, details) => {
    logSettingsDiagnostic(`renderer process gone: ${JSON.stringify(details)}`);
  });

  tabStates = SERVICES.map((service) => ({
    id: service.id,
    label: service.label,
    url: service.url,
    title: service.label,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    secure: service.url.startsWith('https://'),
    error: null
  }));

  activeTab = Math.max(0, Math.min(store.activeTab, SERVICES.length - 1));

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  createViews();
  layoutViews();

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    if (store.maximized) mainWindow.maximize();
    activateTab(activeTab);
    setTimeout(() => {
      if (uiContents && !uiContents.isDestroyed()) sendState();
    }, 50);
  });

  mainWindow.on('resize', () => {
    layoutViews();
    queueStoreWrite();
    maybeWarnBillingWidth();
  });
  mainWindow.on('move', queueStoreWrite);
  mainWindow.on('close', writeStore);
  mainWindow.on('maximize', () => {
    layoutViews();
    sendState();
    queueStoreWrite();
  });
  mainWindow.on('unmaximize', () => {
    layoutViews();
    sendState();
    queueStoreWrite();
  });
  mainWindow.on('enter-full-screen', () => {
    layoutViews();
    sendState();
  });
  mainWindow.on('leave-full-screen', () => {
    layoutViews();
    sendState();
  });
  mainWindow.on('restore', layoutViews);

  mainWindow.on('closed', () => {
    for (const view of views) {
      try {
        if (!view.webContents.isDestroyed()) view.webContents.close();
      } catch {
        /* window teardown already released it */
      }
    }
    views = [];
    tabStates = [];
    uiContents = null;
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// External windows / protocol safety
// ---------------------------------------------------------------------------

function hardenWebContents(contents) {
  if (!contents || contents.isDestroyed()) return;

  contents.setWindowOpenHandler(({ url }) => {
    if (recently(url)) {
      // Keep popups (payment providers, OAuth windows, support widgets) inside
      // the app and in the same cookie jar as the tab that opened them.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 780,
          minWidth: 480,
          minHeight: 360,
          autoHideMenuBar: true,
          backgroundColor: WINDOW_BACKGROUND,
          title: 'ElysianNodes',
          webPreferences: {
            session: contents.session,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
          }
        }
      };
    }

    if (isSftpUrl(url)) {
      openSftpUrl(url);
      return { action: 'deny' };
    }

    if (/^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (!recently(url) && !url.startsWith('about:')) {
      event.preventDefault();
      if (isSftpUrl(url)) openSftpUrl(url);
      else if (/^mailto:/i.test(url)) shell.openExternal(url);
    }
  });

  contents.on('will-redirect', (event, url) => {
    if (!isSftpUrl(url)) return;
    event.preventDefault();
    openSftpUrl(url);
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:get-state', () => buildState());
  ipcMain.handle('updates:get-state', () => ({
    ...updateState,
    appVersion: app.getVersion(),
    supported: UPDATE_SUPPORTED
  }));
  ipcMain.handle('updates:check', async () => {
    if (!UPDATE_SUPPORTED) return { ok: false, error: 'Updates are available in the installed Windows app.' };
    if (isLocked) return { ok: false, error: 'Unlock the app before checking for updates.' };
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not check for updates. Try again later.' };
    }
  });
  ipcMain.handle('updates:download', async () => {
    if (!UPDATE_SUPPORTED || isLocked || updateState.status !== 'available') return { ok: false };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not download the update. Try again later.' };
    }
  });
  ipcMain.handle('updates:install', () => {
    if (!UPDATE_SUPPORTED || isLocked || updateState.status !== 'downloaded') return { ok: false };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
  ipcMain.handle('discord:get-status', () => ({ status: discordStatus, configured: true }));
  ipcMain.handle('passcode:get-state', () => ({ configured: passcodeConfigured, locked: isLocked }));
  ipcMain.handle('passcode:unlock', async (_event, value) => {
    if (!isLocked || !passcodeConfigured) return { ok: !isLocked };
    const verification = await checkPasscode(value);
    if (!verification.ok) return verification;
    isLocked = false;
    appPage = null;
    activateTab(activeTab);
    loadServiceViews();
    connectDiscordRPC();
    return { ok: true };
  });
  ipcMain.handle('passcode:verify', async (_event, value) => {
    if (isLocked || !passcodeConfigured) return { ok: false };
    return checkPasscode(value);
  });
  ipcMain.handle('passcode:save', async (_event, value) => {
    if (isLocked || !value || typeof value !== 'object') return { ok: false, error: 'Unlock the app first.' };
    if (typeof value.passcode !== 'string' || value.passcode.length < 4 || value.passcode.length > 64) {
      return { ok: false, error: 'Use a passcode between 4 and 64 characters.' };
    }
    if (passcodeConfigured) {
      const verification = await checkPasscode(value.currentPasscode);
      if (!verification.ok) return { ok: false, error: verification.retryAfterMs > 0 ? 'Too many attempts. Wait 30 seconds and try again.' : 'Current passcode is incorrect.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(value.passcode, salt, 64)).toString('hex');
    const tempPath = `${passcodePath()}.tmp`;
    fs.mkdirSync(path.dirname(passcodePath()), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify({ salt, hash }), { mode: 0o600 });
    fs.renameSync(tempPath, passcodePath());
    passcodeRecord = { salt, hash };
    passcodeConfigured = true;
    return { ok: true, configured: true };
  });
  ipcMain.handle('passcode:remove', async (_event, value) => {
    if (isLocked || !passcodeConfigured) return { ok: false, error: 'Unlock the app first.' };
    const verification = await checkPasscode(value && value.currentPasscode);
    if (!verification.ok) return { ok: false, error: verification.retryAfterMs > 0 ? 'Too many attempts. Wait 30 seconds and try again.' : 'Current passcode is incorrect.' };
    fs.unlinkSync(passcodePath());
    passcodeRecord = null;
    passcodeConfigured = false;
    return { ok: true, configured: false };
  });
  ipcMain.handle('settings:get', () => {
    const supported = process.platform === 'win32' || process.platform === 'darwin';
    if (supported && app.isPackaged) store.autoStart = getAutoStartEnabled();
    logSettingsDiagnostic(`settings:get autoStart=${store.autoStart} startMinimized=${store.startMinimized} supported=${supported}`);
    return {
      autoStart: store.autoStart,
      startMinimized: store.startMinimized,
      autoStartSupported: supported
    };
  });
  ipcMain.handle('settings:save', (_event, value) => {
    if (isLocked) return { ok: false, error: 'Unlock the app before changing settings.' };
    if (!value || typeof value !== 'object') return { ok: false };
    const supported = process.platform === 'win32' || process.platform === 'darwin';
    store.autoStart = value.autoStart === true;
    store.startMinimized = value.startMinimized === true;
    if (supported && app.isPackaged) {
      applyAutoStart();
      store.autoStart = getAutoStartEnabled();
    }
    writeStore();
    logSettingsDiagnostic(`settings:save requestedAutoStart=${value.autoStart === true} storedAutoStart=${store.autoStart} startMinimized=${store.startMinimized} supported=${supported}`);
    return { ok: true, autoStart: store.autoStart, startMinimized: store.startMinimized };
  });
  ipcMain.handle('settings:clear-app-data', async () => {
    if (isLocked) throw new Error('Unlock the app first.');
    for (const service of SERVICES) {
      const ses = session.fromPartition(service.partition);
      await ses.clearCache();
      await ses.clearStorageData();
    }
    for (const view of views) {
      if (view && !view.webContents.isDestroyed()) view.webContents.reload();
    }
    return { ok: true };
  });
  ipcMain.on('settings:open', () => {
    if (isLocked) {
      if (uiContents && !uiContents.isDestroyed()) uiContents.send('app:page', 'passcode');
      return;
    }
    logSettingsDiagnostic('settings:open received');
    appPage = 'settings';
    for (let index = 0; index < views.length; index += 1) syncViewVisibility(index);
    layoutViews();
    maybeWarnBillingWidth();
    if (uiContents && !uiContents.isDestroyed()) uiContents.send('app:page', appPage);
  });
  ipcMain.on('app:page', (_event, page) => {
    if (isLocked) return;
    appPage = page === 'settings' || page === 'discord' || page === 'welcome' ? page : null;
    for (let index = 0; index < views.length; index += 1) syncViewVisibility(index);
    layoutViews();
    maybeWarnBillingWidth();
  });
  ipcMain.handle('discord:connect', () => {
    if (isLocked) return { ok: false };
    disconnectDiscordRPC();
    setDiscordStatus('Reconnecting to Discord…');
    connectDiscordRPC();
    return { ok: true };
  });

  ipcMain.on('tabs:switch', (_event, index) => {
    if (Number.isInteger(index)) activateTab(index);
  });

  ipcMain.on('nav:back', () => {
    const wc = activeWebContents();
    if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  });

  ipcMain.on('nav:forward', () => {
    const wc = activeWebContents();
    if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  });

  ipcMain.on('nav:reload', () => {
    const wc = activeWebContents();
    if (wc) wc.reload();
  });

  ipcMain.on('nav:hard-reload', () => {
    const wc = activeWebContents();
    if (wc) wc.reloadIgnoringCache();
  });

  ipcMain.on('nav:stop', () => {
    const wc = activeWebContents();
    if (wc) wc.stop();
  });

  ipcMain.on('view:retry', () => {
    if (isLocked) return;
    const index = activeTab;
    const view = views[index];
    if (!view || view.webContents.isDestroyed()) return;
    tabStates[index].error = null;
    tabStates[index].loading = true;
    syncViewVisibility(index);
    sendState();
    view.webContents.reload();
  });

  ipcMain.on('app:open-external', (_event, url) => {
    if (isLocked) return;
    if (recently(url)) shell.openExternal(url);
    else if (isSftpUrl(url)) openSftpUrl(url);
  });

  ipcMain.on('clipboard:write', (_event, text) => {
    if (isLocked) return;
    if (typeof text === 'string' && text.length < 8192) clipboard.writeText(text);
  });

  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.on('layout:embed', (_event, value) => {
    if (!value || typeof value !== 'object') return;
    const keys = ['left', 'top', 'right', 'bottom'];
    if (!keys.every((key) => Number.isFinite(value[key]))) return;

    const nextInsets = {
      left: Math.max(0, Math.min(400, Math.round(value.left))),
      top: Math.max(0, Math.min(600, Math.round(value.top))),
      right: Math.max(0, Math.min(400, Math.round(value.right))),
      bottom: Math.max(0, Math.min(400, Math.round(value.bottom)))
    };
    const nextRadius = Number.isFinite(value.radius)
      ? Math.max(0, Math.min(48, Math.round(value.radius)))
      : DEFAULT_EMBED_RADIUS;

    const unchanged =
      nextInsets.left === embedInsets.left &&
      nextInsets.top === embedInsets.top &&
      nextInsets.right === embedInsets.right &&
      nextInsets.bottom === embedInsets.bottom &&
      nextRadius === embedRadius;
    if (unchanged) return;

    embedInsets = nextInsets;
    embedRadius = nextRadius;
    layoutViews();
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    const launchedAtLogin = process.argv.includes('--start-minimized') ||
      (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
    if (store.startMinimized && launchedAtLogin) mainWindow.minimize();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => {
    // Only embedded services and their popups are hardened. The local UI
    // renderer must be able to load its own file:// document.
    if (!serviceSessions.has(contents.session)) return;
    hardenWebContents(contents);
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('uk.elysiannodes.hub');
    Menu.setApplicationMenu(null);

    const hasSavedStore = readStore();
    const autoStartSupported = process.platform === 'win32' || process.platform === 'darwin';
    if (hasSavedStore && autoStartSupported && app.isPackaged) {
      store.autoStart = getAutoStartEnabled();
    } else if (!hasSavedStore && autoStartSupported && app.isPackaged) {
      applyAutoStart();
    }
    readPasscode();
    configureSessions();
    registerIpc();
    createWindow();
    configureAutoUpdater();
    if (!isLocked) connectDiscordRPC();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    disconnectDiscordRPC();
  });
}
