import type { DesktopIpcServices } from './controllers/registry';

declare module '@lobechat/electron-client-ipc' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface DesktopIpcServicesMap extends DesktopIpcServices {}
}

export { type DesktopIpcServices } from './controllers/registry';
