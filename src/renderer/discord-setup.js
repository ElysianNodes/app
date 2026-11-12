'use strict';

const api = window.elysian;
const connectButton = document.getElementById('connect');
const statusEl = document.getElementById('status');

function showStatus(value, type = '') {
  statusEl.textContent = value;
  statusEl.classList.toggle('is-error', type === 'error');
  statusEl.classList.toggle('is-success', type === 'success');
}

api.onDiscordStatus((value) => showStatus(value));

api.getDiscordStatus().then((result) => showStatus(result.status))
  .catch(() => showStatus('Could not read Discord connection status.', 'error'));

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  showStatus('Reconnecting to the Discord desktop app…');
  try {
    const result = await api.connectDiscord();
    if (!result.ok) {
      showStatus(result.error || 'Could not reconnect Discord.', 'error');
      return;
    }
    showStatus('Reconnecting…');
  } catch (error) {
    showStatus(error.message || 'Could not reconnect Discord.', 'error');
  } finally {
    connectButton.disabled = false;
  }
});
