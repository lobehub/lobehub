import type { UpdateInfo } from '@lobechat/electron-client-ipc';

export const selectUpdateInfo = (current: UpdateInfo | null, incoming: UpdateInfo): UpdateInfo =>
  current?.kind === 'app' && incoming.kind === 'renderer' ? current : incoming;
