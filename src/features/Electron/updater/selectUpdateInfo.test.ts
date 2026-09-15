import type { UpdateInfo } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { selectUpdateInfo } from './selectUpdateInfo';

const appUpdate = { kind: 'app', version: '2.2.16' } satisfies UpdateInfo;
const rendererUpdate = { kind: 'renderer', version: '2.2.15' } satisfies UpdateInfo;

describe('selectUpdateInfo', () => {
  it('keeps an app update ahead of renderer updates', () => {
    expect(selectUpdateInfo(null, rendererUpdate)).toBe(rendererUpdate);
    expect(selectUpdateInfo(rendererUpdate, appUpdate)).toBe(appUpdate);
    expect(selectUpdateInfo(appUpdate, rendererUpdate)).toBe(appUpdate);
  });
});
