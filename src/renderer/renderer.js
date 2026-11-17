'use strict';

const api = window.elysian;

const tabEls = Array.from(document.querySelectorAll('.tab'));
const tabbar = document.querySelector('.tabbar');
const backBtn = document.getElementById('back');
const forwardBtn = document.getElementById('forward');
const reloadBtn = document.getElementById('reload');
const externalBtn = document.getElementById('external');
const lockAppBtn = document.getElementById('lock-app');
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
const welcomeVideo = document.getElementById('welcome-trailer');
const welcomeVideoStatus = document.getElementById('welcome-video-status');
const welcomeSoundButton = document.getElementById('welcome-sound');
const welcomeSkipButton = document.getElementById('welcome-skip');

welcomeVideo.addEventListener('error', () => {
  welcomeVideoStatus.textContent = 'The trailer could not be loaded. Skip ahead to your services.';
});

let latestState = null;
let copyTimer = null;
const serviceToggles = Array.from(document.querySelectorAll('.service-visibility-toggle'));
let visibleServices = [true, true, true];

try {
  const saved = JSON.parse(localStorage.getItem('elysian-visible-services') || 'null');
  if (Array.isArray(saved) && saved.length === tabEls.length && saved.some(Boolean)) {
    visibleServices = saved.map(Boolean);
  }
} catch {}

function updateServiceVisibility() {
  const available = visibleServices.map((visible, index) => visible ? index : -1).filter((index) => index >= 0);
  tabbar.style.setProperty('--visible-tabs-count', available.length);
  tabEls.forEach((tab, index) => {
    tab.classList.toggle('is-hidden', !visibleServices[index]);
    tab.tabIndex = visibleServices[index] ? 0 : -1;
    tab.setAttribute('aria-hidden', String(!visibleServices[index]));
    if (serviceToggles[index]) serviceToggles[index].checked = visibleServices[index];
  });
  const activeIndex = latestState ? latestState.activeTab : 0;
  const position = Math.max(0, available.indexOf(activeIndex));
  tabbar.style.setProperty('--active-tab-index', position);
  if (!visibleServices[activeIndex] && available.length) api.switchTab(available[0]);
}

serviceToggles.forEach((toggle) => {
  toggle.addEventListener('change', () => {
    const index = Number(toggle.dataset.serviceIndex);
    const next = [...visibleServices];
    next[index] = toggle.checked;
    if (!next.some(Boolean)) {
      toggle.checked = true;
      return;
    }
    visibleServices = next;
    try { localStorage.setItem('elysian-visible-services', JSON.stringify(visibleServices)); } catch {}
    updateServiceVisibility();
  });
});
updateServiceVisibility();

function showAppPage(page) {
  const next = page === 'settings' || page === 'discord' || page === 'welcome' || page === 'passcode' ? page : null;
  if (next === 'passcode') {
    document.getElementById('unlock-status').textContent = '';
    document.getElementById('unlock-passcode').value = '';
    document.getElementById('unlock-button').disabled = false;
  }
  appRoot.classList.toggle('is-page', next !== null);
  settingsPage.hidden = next !== 'settings';
  discordPage.hidden = next !== 'discord';
  welcomePage.hidden = next !== 'welcome';
  passcodePage.hidden = next !== 'passcode';
  if (next === 'settings') window.dispatchEvent(new Event('settings:shown'));
  if (next === 'welcome') {
    welcomeVideo.currentTime = 0;
    welcomeVideo.muted = true;
    welcomeSoundButton.textContent = 'Turn sound on';
    welcomeSkipButton.innerHTML = 'Skip intro <span>→</span>';
    welcomeVideoStatus.textContent = 'Watch the trailer or skip ahead to your services.';
    requestAnimationFrame(() => welcomeVideo.play().catch(() => {
      welcomeVideoStatus.textContent = 'Press play to watch the trailer, or skip ahead to your services.';
    }));
  } else if (!welcomeVideo.paused) {
    welcomeVideo.pause();
  }
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
  lockAppBtn.hidden = !state.passcodeConfigured;

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
  const visibleIndex = visibleServices.slice(0, state.activeTab).filter(Boolean).length;
  tabbar.style.setProperty('--active-tab-index', visibleIndex);

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
    const available = visibleServices.map((visible, tabIndex) => visible ? tabIndex : -1).filter((tabIndex) => tabIndex >= 0);
    const currentPosition = available.indexOf(index);
    const next = available[(currentPosition + direction + available.length) % available.length];
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
lockAppBtn.addEventListener('click', async () => {
  lockAppBtn.disabled = true;
  try {
    await api.lockWithPasscode();
  } finally {
    lockAppBtn.disabled = false;
  }
});
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
welcomeSkipButton.addEventListener('click', () => {
  try { localStorage.setItem('elysian-welcome-complete', '1'); } catch {}
  welcomeVideo.pause();
  showAppPage(null);
});

welcomeSoundButton.addEventListener('click', () => {
  welcomeVideo.muted = !welcomeVideo.muted;
  welcomeSoundButton.textContent = welcomeVideo.muted ? 'Turn sound on' : 'Turn sound off';
  if (welcomeVideo.paused) welcomeVideo.play().catch(() => {});
});

welcomeVideo.addEventListener('ended', () => {
  welcomeVideoStatus.textContent = 'Trailer finished. Continue to your services when you’re ready.';
  welcomeSkipButton.innerHTML = 'Continue <span>→</span>';
});
welcomeVideo.addEventListener('error', () => {
  welcomeVideoStatus.textContent = 'The trailer could not be loaded. You can still continue to your services.';
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
    const index = Number(event.key) - 1;
    if (visibleServices[index]) api.switchTab(index);
    return;
  }

  if (ctrl && event.key === 'Tab') {
    event.preventDefault();
    const index = latestState ? latestState.activeTab : 0;
    const available = visibleServices.map((visible, tabIndex) => visible ? tabIndex : -1).filter((tabIndex) => tabIndex >= 0);
    const position = available.indexOf(index);
    api.switchTab(available[(position + 1) % available.length]);
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
