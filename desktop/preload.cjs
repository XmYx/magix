// Organicity desktop — tells the game it runs as an app (no service worker, no "back to the site").
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('organicityDesktop', { platform: process.platform, version: process.versions.electron });
