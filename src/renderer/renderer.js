'use strict';

const api = window.elysian;

const tabEls = Array.from(document.querySelectorAll('.tab'));
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const externalBtn = document.getElementById('external');
const copyBtn = document.getElementById('copy');
const hostEl = document.getElementById('url-host');
const pathEl = document.getElementById('url-path');
const lockEl = document.getElementById('lock');
const errorPanel = document.getElementById('error-panel');
const errorTitle = document.getElementById('error-title');
const errorDetail = document.getElementById('error-detail');
const errorUrl = document.getElementById('error-url');
const retryBtn = document.getElementById('retry');
const errorExternalBtn = document.getElementById('error-external');
const boot = document.getElementById('boot');
const embedFrame = document.querySelector('.embed-frame');
const embedSlot = document.getElementById('embed-slot');
const appRoot = document.querySelector('.app');
const settingsPage = document.getElementById('settings-page');
const discordPage = document.getElementById('discord-page');
const welcomePage = document.getElementById('welcome-page');
const passcodePage = document.getElementById('passcode-page');

let latestState = null;
let copyTimer = null;

function showAppPage(page) {
  const next = page === 'settings' || page === 'discord' || page === 'welcome' || page === 'passcode' ? page : null;
  appRoot.classList.toggle('is-page', next !== null);
  settingsPage.hidden = next !== 'settings';
  discordPage.hidden = next !== 'discord';
  welcomePage.hidden = next !== 'welcome';
  passcodePage.hidden = next !== 'passcode';
  api.setAppPage(next);
}
window.showAppPage = showAppPage;

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function displayHost(value) {
  const parsed = parseUrl(value);
  if (parsed) return parsed.host;
  return value || 'about:blank';
}

function displayPath(value) {
  const parsed = parseUrl(value);
  if (!parsed) return '/';
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return path === '/' ? '/' : path;
}

function render(state) {
  if (!state || !Array.isArray(state.tabs) || state.tabs.length === 0) return;

  latestState = state;
  const active = state.tabs[state.activeTab];
  if (!active) return;

  document.body.classList.toggle('is-maximized', Boolean(state.maximized));
  document.body.classList.toggle('is-loading', Boolean(active.loading));
  document.body.classList.toggle('has-error', Boolean(active.error));

  tabEls.forEach((tabEl, index) => {
    const tab = state.tabs[index];
    if (!tab) return;

    const isActive = index === state.activeTab;
    tabEl.classList.toggle('is-active', isActive);
    tabEl.classList.toggle('is-loading', Boolean(tab.loading));
    tabEl.classList.toggle('is-error', Boolean(tab.error));
    tabEl.setAttribute('aria-selected', String(isActive));
    tabEl.setAttribute('aria-busy', String(Boolean(tab.loading)));
    tabEl.title = tab.title ? `${tab.title}\n${tab.url}` : tab.url;
  });

  hostEl.textContent = displayHost(active.url);
  pathEl.textContent = displayPath(active.url);
  pathEl.title = active.url || '';

  const secure = Boolean(active.secure);
  lockEl.classList.toggle('is-insecure', !secure);
  lockEl.title = secure ? 'Secure HTTPS connection' : 'Not a secure connection';

  backBtn.disabled = !active.canGoBack;
  forwardBtn.disabled = !active.canGoForward;

  if (active.error) {
    const description = active.error.description || 'The page could not be loaded.';
    const code = active.error.code || '';
    errorTitle.textContent = `${active.label} is unreachable`;
    errorDetail.textContent =
      code && !String(description).includes(code) ? `${description} (${code})` : description;
    errorUrl.textContent = active.error.url || active.url || '';
    errorPanel.hidden = false;
    boot.hidden = true;
  } else {
    errorPanel.hidden = true;
    boot.hidden = true;
  }
}

function currentTab() {
  if (!latestState) return null;
  return latestState.tabs[latestState.activeTab] || null;
}

function reportEmbedLayout() {
  if (!embedSlot) return;
  const rect = embedSlot.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(embedSlot).borderTopLeftRadius) || 19;
  api.setEmbedLayout({
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(window.innerWidth - rect.right),
    bottom: Math.round(window.innerHeight - rect.bottom),
    radius
  });
}

/* ---------------------------------------------------------------- */
/* Controls                                                          */
/* ---------------------------------------------------------------- */

tabEls.forEach((tabEl, index) => {
  tabEl.addEventListener('click', () => api.switchTab(index));

  tabEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + direction + tabEls.length) % tabEls.length;
    tabEls[next].focus();
    api.switchTab(next);
  });
});

backBtn.addEventListener('click', () => api.back());
forwardBtn.addEventListener('click', () => api.forward());

reloadBtn.addEventListener('click', () => {
  const tab = currentTab();
  if (tab && tab.loading) api.stop();
  else api.reload();
});

externalBtn.addEventListener('click', () => {
  const tab = currentTab();
  if (tab && tab.url) api.openExternal(tab.url);
});

copyBtn.addEventListener('click', () => {
  const tab = currentTab();
  if (!tab || !tab.url) return;
  api.copyText(tab.url);
  copyBtn.classList.add('is-copied');
  copyBtn.title = 'Copied!';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyBtn.classList.remove('is-copied');
    copyBtn.title = 'Copy URL';
  }, 1300);
});

retryBtn.addEventListener('click', () => api.retry());

errorExternalBtn.addEventListener('click', () => {
  const tab = currentTab();
  if (tab && tab.url) api.openExternal(tab.url);
});

document.getElementById('win-min').addEventListener('click', () => api.minimize());
document.getElementById('win-max').addEventListener('click', () => api.toggleMaximize());
document.getElementById('win-close').addEventListener('click', () => api.close());
document.getElementById('open-settings').addEventListener('click', () => api.openSettings());
document.querySelectorAll('[data-page-back]').forEach((button) => {
  button.addEventListener('click', () => showAppPage(button.closest('#discord-page') ? 'settings' : null));
});
api.onAppPage(showAppPage);
document.getElementById('passcode-unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('unlock-passcode');
  const button = document.getElementById('unlock-button');
  const status = document.getElementById('unlock-status');
  button.disabled = true;
  status.textContent = 'Checking passcode…';
  try {
    const result = await api.unlockWithPasscode(input.value);
    if (!result || !result.ok) {
      status.textContent = result && result.retryAfterMs > 0
        ? 'Too many attempts. Please wait 30 seconds and try again.'
        : 'That passcode did not match. Try again.';
      input.value = '';
      input.focus();
      return;
    }
    input.value = '';
    let hasSeenWelcome = false;
    try { hasSeenWelcome = localStorage.getItem('elysian-welcome-complete') === '1'; } catch {}
    showAppPage(hasSeenWelcome ? null : 'welcome');
  } catch {
    status.textContent = 'Could not check passcode. Try again.';
  } finally {
    button.disabled = false;
  }
});
document.getElementById('welcome-start').addEventListener('click', () => {
  try { localStorage.setItem('elysian-welcome-complete', '1'); } catch {}
  showAppPage(null);
});

document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  const key = String(event.key).toLowerCase();

  if (event.key === 'F5' || (ctrl && key === 'r')) {
    event.preventDefault();
    if (event.shiftKey) api.hardReload();
    else api.reload();
    return;
  }

  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    api.back();
    return;
  }

  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    api.forward();
    return;
  }

  if (ctrl && ['1', '2', '3'].includes(event.key)) {
    event.preventDefault();
    api.switchTab(Number(event.key) - 1);
    return;
  }

  if (ctrl && event.key === 'Tab') {
    event.preventDefault();
    const index = latestState ? latestState.activeTab : 0;
    api.switchTab((index + 1) % tabEls.length);
  }
});

/* ---------------------------------------------------------------- */
/* Boot                                                              */
/* ---------------------------------------------------------------- */

if (embedFrame && typeof ResizeObserver === 'function') {
  new ResizeObserver(reportEmbedLayout).observe(embedFrame);
}

window.addEventListener('load', reportEmbedLayout);
window.addEventListener('resize', reportEmbedLayout);

api.onState(render);
api.getState().then(render).catch(() => {
  /* main process not ready - state updates will arrive shortly */
});

api.getPasscodeState().then((state) => {
  if (state && state.locked) showAppPage('passcode');
  else {
    let hasSeenWelcome = false;
    try { hasSeenWelcome = localStorage.getItem('elysian-welcome-complete') === '1'; } catch {}
    if (!hasSeenWelcome) showAppPage('welcome');
  }
}).catch(() => showAppPage('passcode'));

requestAnimationFrame(reportEmbedLayout);
