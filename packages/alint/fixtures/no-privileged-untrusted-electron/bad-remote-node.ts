import { BrowserWindow } from 'electron';

export const preview = (input: { remoteUrl: string }) => {
  // alint-expect
  const window = new BrowserWindow({ webPreferences: { nodeIntegration: true } });
  return window.loadURL(input.remoteUrl);
};
