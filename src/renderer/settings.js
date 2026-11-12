'use strict';

const api = window.elysian;
const autoStart = document.getElementById('auto-start');
const startMinimized = document.getElementById('start-minimized');
const platformNote = document.getElementById('platform-note');
const saveStatus = document.getElementById('save-status');
let saveTimer;
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
