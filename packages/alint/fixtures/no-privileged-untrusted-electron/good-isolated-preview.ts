import { BrowserWindow } from 'electron';

export const preview = (input: { remoteUrl: string }) => {
  const window = new BrowserWindow({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  return window.loadURL(input.remoteUrl);
};
