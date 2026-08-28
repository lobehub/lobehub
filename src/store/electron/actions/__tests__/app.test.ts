import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useElectronStore } from '@/store/electron';

describe('ElectronAppActionImpl', () => {
  beforeEach(() => {
    globalAgentContextManager.setContext({});
    useElectronStore.setState({ appState: {} });
  });

  describe('updateElectronAppState', () => {
    it('merges the update into appState', () => {
      act(() => {
        useElectronStore.getState().updateElectronAppState({ defaultShell: 'Git Bash' });
      });

      expect(useElectronStore.getState().appState.defaultShell).toBe('Git Bash');
    });

    it('syncs defaultShell into the global agent context so the platform default shell (PowerShell on Windows, /bin/sh on macOS/Linux) flips without a restart', () => {
      // Regression: switching the Windows shell in settings only updated the
      // main process; the prompt placeholder kept describing the old shell
      // until app restart.
      act(() => {
        useElectronStore.getState().updateElectronAppState({ defaultShell: 'Git Bash' });
      });

      expect(globalAgentContextManager.getContext().defaultShell).toBe('Git Bash');
    });

    it('syncs arch into the global agent context so unknown renders in the prompt', () => {
      act(() => {
        useElectronStore.getState().updateElectronAppState({ arch: 'arm64' });
      });

      expect(globalAgentContextManager.getContext().arch).toBe('arm64');
    });

    it('syncs user paths into the global agent context', () => {
      act(() => {
        useElectronStore.getState().updateElectronAppState({
          userPath: {
            desktop: '/home/u/Desktop',
            documents: '/home/u/Documents',
            home: '/home/u',
            userData: '/home/u/.config/lobehub',
          },
        });
      });

      const context = globalAgentContextManager.getContext();
      expect(context.homePath).toBe('/home/u');
      expect(context.desktopPath).toBe('/home/u/Desktop');
    });

    it('leaves existing context fields untouched when the update omits them', () => {
      globalAgentContextManager.setContext({ defaultShell: 'PowerShell 7+ (pwsh)' });

      act(() => {
        useElectronStore.getState().updateElectronAppState({ locale: 'en-US' });
      });

      expect(globalAgentContextManager.getContext().defaultShell).toBe('PowerShell 7+ (pwsh)');
    });
  });
});
