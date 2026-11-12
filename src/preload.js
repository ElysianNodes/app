'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let stateListener = null;
let pageListener = null;
let discordStatusListener = null;

contextBridge.exposeInMainWorld('elysian', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  onState: (callback) => {
    if (stateListener) ipcRenderer.removeListener('state:update', stateListener);
    stateListener = (_event, state) => callback(state);
    ipcRenderer.on('state:update', stateListener);
    return () => {
      if (stateListener) ipcRenderer.removeListener('state:update', stateListener);
      stateListener = null;
    };
  },
  switchTab: (index) => ipcRenderer.send('tabs:switch', index),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  hardReload: () => ipcRenderer.send('nav:hard-reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  retry: () => ipcRenderer.send('view:retry'),
  openExternal: (url) => ipcRenderer.send('app:open-external', url),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  setEmbedLayout: (layout) => ipcRenderer.send('layout:embed', layout),
  openSettings: () => ipcRenderer.send('settings:open'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getPasscodeState: () => ipcRenderer.invoke('passcode:get-state'),
  unlockWithPasscode: (passcode) => ipcRenderer.invoke('passcode:unlock', passcode),
  verifyPasscode: (passcode) => ipcRenderer.invoke('passcode:verify', passcode),
  savePasscode: (settings) => ipcRenderer.invoke('passcode:save', settings),
  removePasscode: (settings) => ipcRenderer.invoke('passcode:remove', settings),
  clearAppData: () => ipcRenderer.invoke('settings:clear-app-data'),
  setAppPage: (page) => ipcRenderer.send('app:page', page),
  getDiscordStatus: () => ipcRenderer.invoke('discord:get-status'),
  connectDiscord: () => ipcRenderer.invoke('discord:connect'),
  onAppPage: (callback) => {
    if (pageListener) ipcRenderer.removeListener('app:page', pageListener);
    pageListener = (_event, page) => callback(page);
    ipcRenderer.on('app:page', pageListener);
  },
  onDiscordStatus: (callback) => {
    if (discordStatusListener) ipcRenderer.removeListener('discord:status', discordStatusListener);
    discordStatusListener = (_event, status) => callback(status);
    ipcRenderer.on('discord:status', discordStatusListener);
  }
});
