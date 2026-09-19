import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';
import type { ElectronMainStore } from '@/types/store';

import CompletionSoundCtr from '../CompletionSoundCtr';

const mocks = vi.hoisted(() => {
  let resources = '';
  return {
    getPath: vi.fn(),
    getSoundSetting: vi.fn(),
    resourcesDir: () => resources,
    setResourcesDir: (value: string) => {
      resources = value;
    },
    showOpenDialog: vi.fn(),
  };
});
vi.mock('@/const/dir', () => ({
  get resourcesDir() {
    return mocks.resourcesDir();
  },
}));
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('@lobechat/electron-mac-notifications', () => ({
  getSoundSetting: mocks.getSoundSetting,
}));
vi.mock('@/utils/platform', () => ({ macOS: () => true }));

describe('local completion sound settings', () => {
  let directory: string;
  let saved: ElectronMainStore['completionSound'];
  let controller: CompletionSoundCtr;
  const application = {
    storeManager: {
      get: () => saved,
      set: (_key: string, value: ElectronMainStore['completionSound']) => {
        saved = value;
      },
    },
  } as unknown as App;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'completion-sound-ctr-'));
    mocks.getPath.mockReturnValue(directory);
    mocks.setResourcesDir(directory);
    await mkdir(path.join(directory, 'sounds'), { recursive: true });
    await writeFile(path.join(directory, 'sounds', 'lobehub-complete.aiff'), 'FORM');
    mocks.getSoundSetting.mockResolvedValue('enabled');
    saved = undefined;
    controller = new CompletionSoundCtr(application);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('copies selected sound into app storage and preserves it across controller restart and source removal', async () => {
    await controller.setSettings({ enabled: true });
    const source = path.join(directory, 'original.wav');
    const audio = Buffer.from('RIFF0000WAVEfmt ');
    await writeFile(source, audio);
    mocks.showOpenDialog.mockResolvedValue({ filePaths: [source] });
    await controller.importSound();
    await controller.setSettings({ volume: 0.3 });
    await rm(source);
    controller = new CompletionSoundCtr(application);
    expect(await controller.getPlayback()).toEqual({
      dataUrl: `data:audio/wav;base64,${audio.toString('base64')}`,
      play: true,
      volume: 0.3,
    });
    const oldDirectory = saved!.directory!;
    await controller.setSettings({ builtin: 'glassBell' });
    expect(await controller.getSettings()).toEqual({
      builtin: 'glassBell',
      enabled: true,
      name: undefined,
      notificationSound: 'system',
      systemSoundDisabled: false,
      volume: 0.3,
    });
    await expect(readFile(path.join(oldDirectory, '0.wav'))).rejects.toThrow();
    expect(await controller.getPlayback()).toEqual({
      builtin: 'glassBell',
      play: true,
      volume: 0.3,
    });
  });

  it('keeps the chosen built-in sound while other settings change', async () => {
    await controller.setSettings({ builtin: 'xylophone' });
    await controller.setSettings({ enabled: true, volume: 0.5 });
    expect(await controller.getPlayback()).toEqual({
      builtin: 'xylophone',
      play: true,
      volume: 0.5,
    });
    await expect(controller.setSettings({ builtin: 'missing' as never })).rejects.toThrow();
  });

  it('keeps prior settings when the picker is canceled or a new import is invalid', async () => {
    await controller.setSettings({ enabled: false, volume: 0.2 });
    const previous = saved;
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await controller.importSound();
    const source = path.join(directory, 'bad.mp3');
    await writeFile(source, 'not an mp3');
    mocks.showOpenDialog.mockResolvedValue({ filePaths: [source] });
    await expect(controller.importSound()).rejects.toThrow();
    expect(saved).toBe(previous);
  });

  it('validates settings at the IPC boundary without changing stored settings', async () => {
    await controller.setSettings({ volume: 0.5 });
    await expect(controller.setSettings({ volume: 2 })).rejects.toThrow();
    await expect(controller.setSettings({ volume: Number.NaN })).rejects.toThrow();
    expect((await controller.getSettings()).volume).toBe(0.5);
  });

  it('keeps the in-app chime off by default while a preview still plays', async () => {
    expect(await controller.getPlayback()).toEqual({ play: false, volume: 0.7 });
    expect(await controller.getPlayback({ preview: true })).toEqual({
      builtin: 'lobehub',
      play: true,
      volume: 0.7,
    });
    await controller.setSettings({ volume: 0 });
    expect(await controller.getPlayback({ preview: true })).toEqual({ play: false, volume: 0 });
  });

  it('reports the system sound state without muting the in-app chime', async () => {
    mocks.getSoundSetting.mockResolvedValue('disabled');
    await controller.setSettings({ enabled: true });
    expect(await controller.getSettings()).toMatchObject({ systemSoundDisabled: true });
    expect(await controller.getPlayback()).toMatchObject({ play: true });
  });

  it('installs the banner sound into the user Sounds folder only when our chime is picked', async () => {
    const target = path.join(directory, 'Library', 'Sounds', 'lobehub-complete.aiff');
    expect(await controller.getNotificationSoundFile()).toBeUndefined();
    await expect(readFile(target)).rejects.toThrow();

    await controller.setSettings({ notificationSound: 'lobehub' });
    expect(await controller.getNotificationSoundFile()).toBe('lobehub-complete.aiff');
    expect(await readFile(target, 'utf8')).toBe('FORM');
  });

  it('falls back to the system sound when the bundled file is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await rm(path.join(directory, 'sounds'), { force: true, recursive: true });
      await controller.setSettings({ notificationSound: 'lobehub' });
      expect(await controller.getNotificationSoundFile()).toBeUndefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('selects completion sounds without immediate repeats', async () => {
    await writeFile(path.join(directory, 'a.wav'), 'RIFF0000WAVEa');
    await writeFile(path.join(directory, 'b.wav'), 'RIFF0000WAVEb');
    const source = path.join(directory, 'openpeon.json');
    await writeFile(
      source,
      JSON.stringify({
        categories: { 'task.complete': { sounds: [{ file: 'a.wav' }, { file: 'b.wav' }] } },
        cesp_version: '1.0',
        display_name: 'Two sounds',
      }),
    );
    mocks.showOpenDialog.mockResolvedValue({ filePaths: [source] });
    await controller.importSound();
    const first = await controller.getPlayback({ preview: true });
    const second = await controller.getPlayback({ preview: true });
    expect(first.dataUrl).not.toBe(second.dataUrl);
  });
});
