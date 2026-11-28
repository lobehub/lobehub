import type * as ConstModule from '@lobechat/const';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElectronStore } from '@/store/electron';

import { useAppOrigin } from './useAppOrigin';

const platform = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof ConstModule>()),
  get isDesktop() {
    return platform.isDesktop;
  },
}));

const originalState = useElectronStore.getState();

afterEach(() => {
  platform.isDesktop = false;
  useElectronStore.setState(originalState, true);
});

describe('useAppOrigin', () => {
  it('uses the browser origin in a client-only web host', () => {
    const { result } = renderHook(useAppOrigin);
    expect(result.current).toBe(window.location.origin);
  });

  it('preserves the desktop self-hosted origin without trailing slashes', () => {
    platform.isDesktop = true;
    useElectronStore.setState({
      dataSyncConfig: {
        ...originalState.dataSyncConfig,
        remoteServerUrl: 'https://self-hosted.example///',
        storageMode: 'selfHost',
      },
    });

    const { result } = renderHook(useAppOrigin);
    expect(result.current).toBe('https://self-hosted.example');
  });
});
