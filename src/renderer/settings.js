'use strict';

const api = window.elysian;
const autoStart = document.getElementById('auto-start');
const startMinimized = document.getElementById('start-minimized');
const platformNote = document.getElementById('platform-note');
const saveStatus = document.getElementById('save-status');
const accentColor = document.getElementById('accent-color');
const accentColorValue = document.getElementById('accent-color-value');
const resetAccentColor = document.getElementById('reset-accent-color');
const replayWelcomeButton = document.getElementById('replay-welcome');
const appVersion = document.getElementById('app-version');
const settingsTabsNav = document.querySelector('.settings-tabs');
const settingsTabIndicator = document.querySelector('.settings-tab-indicator');
const settingsTabs = Array.from(document.querySelectorAll('[data-settings-tab]'));
const settingsPanels = Array.from(document.querySelectorAll('[data-settings-panel]'));
const updateStatus = document.getElementById('update-status');
const checkUpdatesButton = document.getElementById('check-updates');
const downloadUpdateButton = document.getElementById('download-update');
const installUpdateButton = document.getElementById('install-update');
const updateProgress = document.getElementById('update-progress');
const updateProgressBar = document.getElementById('update-progress-bar');
let saveTimer;
function moveSettingsTabIndicator(tab) {
  if (!tab || !settingsTabIndicator || !tab.offsetWidth) return;
  settingsTabIndicator.style.width = `${tab.offsetWidth}px`;
  settingsTabIndicator.style.transform = `translateX(${tab.offsetLeft}px)`;
}

function showSettingsCategory(category) {
  const selectedTab = settingsTabs.find((tab) => tab.dataset.settingsTab === category);
  settingsTabs.forEach((tab) => {
    const selected = tab === selectedTab;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  moveSettingsTabIndicator(selectedTab);
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== category;
  });
  try { localStorage.setItem('elysian-settings-category', category); } catch {}
}
window.addEventListener('resize', () => {
  moveSettingsTabIndicator(settingsTabs.find((tab) => tab.classList.contains('is-active')));
});
window.addEventListener('settings:shown', () => {
  requestAnimationFrame(() => moveSettingsTabIndicator(settingsTabs.find((tab) => tab.classList.contains('is-active'))));
});
if (settingsTabsNav && typeof ResizeObserver === 'function') {
  new ResizeObserver(() => moveSettingsTabIndicator(settingsTabs.find((tab) => tab.classList.contains('is-active')))).observe(settingsTabsNav);
}

let initialSettingsCategory = 'appearance';
try {
  const savedCategory = localStorage.getItem('elysian-settings-category');
  if (settingsTabs.some((tab) => tab.dataset.settingsTab === savedCategory)) initialSettingsCategory = savedCategory;
} catch {}
showSettingsCategory(initialSettingsCategory);
settingsTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showSettingsCategory(tab.dataset.settingsTab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + direction + settingsTabs.length) % settingsTabs.length;
    settingsTabs[next].focus();
    showSettingsCategory(settingsTabs[next].dataset.settingsTab);
  });
});

const DEFAULT_ACCENT = '#1f5bff';

function applyAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover', `color-mix(in srgb, ${color} 82%, white)`);
  document.documentElement.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} 12%, transparent)`);
  document.documentElement.style.setProperty('--accent-border', `color-mix(in srgb, ${color} 24%, transparent)`);
  document.documentElement.style.setProperty('--glow-strong', `color-mix(in srgb, ${color} 16%, transparent)`);
  document.documentElement.style.setProperty('--glow-weak', `color-mix(in srgb, ${color} 5%, transparent)`);
  accentColor.value = color;
  accentColorValue.textContent = color.toUpperCase();
}

try {
  const savedAccent = localStorage.getItem('elysian-accent-color');
  applyAccentColor(/^#[\da-f]{6}$/i.test(savedAccent || '') ? savedAccent : DEFAULT_ACCENT);
} catch {
  applyAccentColor(DEFAULT_ACCENT);
}

accentColor.addEventListener('input', () => {
  applyAccentColor(accentColor.value);
  try { localStorage.setItem('elysian-accent-color', accentColor.value); } catch {}
});

resetAccentColor.addEventListener('click', () => {
  applyAccentColor(DEFAULT_ACCENT);
  try { localStorage.removeItem('elysian-accent-color'); } catch {}
});

const debugSettings = (message) => console.info(`[SettingsDebug] ${message}`);
debugSettings('loaded');

function save() {
  clearTimeout(saveTimer);
  saveStatus.textContent = 'Saving…';
  saveTimer = setTimeout(async () => {
    try {
      const result = await api.saveSettings({ autoStart: autoStart.checked, startMinimized: startMinimized.checked });
      debugSettings(`save response ok=${Boolean(result && result.ok)}`);
      if (!result || !result.ok) {
        saveStatus.textContent = (result && result.error) || 'Could not save settings';
        return;
      }
      if (typeof result.autoStart === 'boolean' && result.autoStart !== autoStart.checked) {
        autoStart.checked = result.autoStart;
        saveStatus.textContent = 'Startup preference updated on this system';
      } else {
        saveStatus.textContent = 'Settings saved';
      }
    } catch {
      debugSettings('settings save rejected');
      saveStatus.textContent = 'Could not save settings';
    }
  }, 180);
}

autoStart.addEventListener('change', () => { debugSettings(`autoStart changed ${autoStart.checked}`); save(); });
startMinimized.addEventListener('change', () => { debugSettings(`startMinimized changed ${startMinimized.checked}`); save(); });
document.getElementById('discord-settings').addEventListener('click', () => { debugSettings('Discord configure clicked'); window.showAppPage('discord'); });

api.getAppInfo().then((info) => {
  appVersion.textContent = info && info.version ? `v${info.version}` : 'Desktop App';
  replayWelcomeButton.hidden = !(info && info.isDev);
}).catch(() => { replayWelcomeButton.hidden = true; });

replayWelcomeButton.addEventListener('click', () => {
  try { localStorage.removeItem('elysian-welcome-complete'); } catch {}
  window.showAppPage('welcome');
});

function showUpdateState(state) {
  if (!state) return;
  updateStatus.textContent = state.supported === false
    ? 'Updates are available in the installed Windows app.'
    : state.message;
  checkUpdatesButton.disabled = !state.supported || state.status === 'checking' || state.status === 'downloading';
  downloadUpdateButton.hidden = state.status !== 'available';
  downloadUpdateButton.disabled = !state.supported;
  installUpdateButton.hidden = state.status !== 'downloaded';
  installUpdateButton.disabled = !state.supported;
  updateProgress.hidden = state.status !== 'downloading';
  updateProgressBar.style.width = `${Math.max(0, Math.min(100, Number(state.percent) || 0))}%`;
}

checkUpdatesButton.addEventListener('click', async () => {
  updateStatus.textContent = 'Checking for updates…';
  checkUpdatesButton.disabled = true;
  const result = await api.checkForUpdates();
  if (!result || !result.ok) {
    updateStatus.textContent = (result && result.error) || 'Could not check for updates. Try again later.';
    checkUpdatesButton.disabled = false;
  }
});

downloadUpdateButton.addEventListener('click', async () => {
  downloadUpdateButton.disabled = true;
  updateStatus.textContent = 'Starting download…';
  const result = await api.downloadUpdate();
  if (!result || !result.ok) {
    updateStatus.textContent = (result && result.error) || 'Could not download the update. Try again later.';
    downloadUpdateButton.disabled = false;
  }
});

installUpdateButton.addEventListener('click', () => api.installUpdate());
api.onUpdateStatus(showUpdateState);
api.getUpdateState().then(showUpdateState).catch(() => {
  updateStatus.textContent = 'Could not load update status.';
});

document.getElementById('clear-app-data').addEventListener('click', async (event) => {
  debugSettings('clear data clicked');
  if (!window.confirm('Clear cached files, cookies, and saved website data for all services? You may need to sign in again.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  saveStatus.textContent = 'Clearing app data…';
  try {
    await api.clearAppData();
    saveStatus.textContent = 'Cache and website data cleared';
  } catch {
    saveStatus.textContent = 'Could not clear app data';
  } finally {
    button.disabled = false;
  }
});

api.getSettings().then((settings) => {
  debugSettings(`settings loaded autoStart=${settings.autoStart} startMinimized=${settings.startMinimized}`);
  autoStart.checked = settings.autoStart;
  startMinimized.checked = settings.startMinimized;
  if (!settings.autoStartSupported) {
    platformNote.hidden = false;
    autoStart.disabled = true;
  }
}).catch((error) => { debugSettings(`settings load rejected ${error && error.message}`); saveStatus.textContent = 'Could not load settings'; });
