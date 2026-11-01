import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import pathUtils from 'node:path';

import {
  COMPLETION_BUILTIN_SOUNDS,
  type CompletionSoundPlayback,
  type CompletionSoundSettings,
} from '@lobechat/electron-client-ipc';
import { app, dialog } from 'electron';
import { z } from 'zod';

import { resourcesDir } from '@/const/dir';
import { readCompletionSoundImport } from '@/modules/completionSound';
import { macOS } from '@/utils/platform';

import { ControllerModule, IpcMethod } from './index';

const settingsSchema = z
  .object({
    builtin: z.enum(COMPLETION_BUILTIN_SOUNDS).optional(),
    enabled: z.boolean().optional(),
    notificationSound: z.enum(['lobehub', 'system']).optional(),
    volume: z.number().min(0).max(1).optional(),
  })
  .strict();

/**
 * UNNotificationSound resolves a name only against `~/Library/Sounds`, and only AIFF —
 * the app bundle is never searched, and a WAV there falls back to the system alert sound.
 * So the banner sound has to be installed into the user's own Sounds folder.
 */
const BANNER_SOUND_FILE = 'lobehub-complete.aiff';

export default class CompletionSoundCtr extends ControllerModule {
  static override readonly groupName = 'completionSound';
  private lastFile?: string;

  @IpcMethod()
  async getSettings(): Promise<CompletionSoundSettings> {
    return { ...this.readSettings(), systemSoundDisabled: await this.isSystemSoundDisabled() };
  }

  /** Picking a built-in sound drops the imported pack so the two never compete. */
  @IpcMethod()
  async setSettings(input: {
    builtin?: CompletionSoundSettings['builtin'];
    enabled?: boolean;
    notificationSound?: CompletionSoundSettings['notificationSound'];
    volume?: number;
  }): Promise<CompletionSoundSettings> {
    const changes = settingsSchema.parse(input);
    const previous = this.app.storeManager.get('completionSound');
    this.app.storeManager.set('completionSound', {
      ...(changes.builtin
        ? { ...this.readSettings(), name: undefined }
        : { ...this.readSettings(), ...previous }),
      ...changes,
    });
    if (changes.builtin && previous?.directory)
      await this.removeImportedDirectory(previous.directory);
    return this.getSettings();
  }

  @IpcMethod()
  async importSound(): Promise<CompletionSoundSettings> {
    const result = await dialog.showOpenDialog({
      filters: [{ extensions: ['wav', 'mp3', 'ogg', 'json'], name: 'Audio / OpenPeon' }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return this.getSettings();
    const imported = await readCompletionSoundImport(result.filePaths[0]);
    const root = pathUtils.join(app.getPath('userData'), 'completion-sounds');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(pathUtils.join(root, 'pack-'));
    try {
      const files = [];
      for (const [index, sound] of imported.sounds.entries()) {
        const file = `${index}${sound.extension}`;
        await writeFile(pathUtils.join(directory, file), sound.data);
        files.push({ file, mime: sound.mime });
      }
      const previous = this.app.storeManager.get('completionSound');
      this.app.storeManager.set('completionSound', {
        ...this.readSettings(),
        directory,
        files,
        name: imported.name,
      });
      if (previous?.directory) await this.removeImportedDirectory(previous.directory);
    } catch (error) {
      await this.removeImportedDirectory(directory);
      throw error;
    }
    return this.getSettings();
  }

  /** Sound file the background banner carries; absent means the macOS default sound. */
  @IpcMethod()
  async getNotificationSoundFile(): Promise<string | undefined> {
    if (!macOS() || this.readSettings().notificationSound !== 'lobehub') return undefined;
    try {
      const source = pathUtils.join(resourcesDir, 'sounds', BANNER_SOUND_FILE);
      const target = pathUtils.join(app.getPath('home'), 'Library', 'Sounds', BANNER_SOUND_FILE);
      const [installed, existing] = await Promise.all([
        stat(source),
        stat(target).catch(() => undefined),
      ]);
      if (installed.size !== existing?.size) {
        await mkdir(pathUtils.dirname(target), { recursive: true });
        await copyFile(source, target);
      }
      return BANNER_SOUND_FILE;
    } catch (error) {
      console.error('Failed to install the notification sound:', error);
      return undefined;
    }
  }

  @IpcMethod()
  async getPlayback(input?: { preview?: boolean }): Promise<CompletionSoundPlayback> {
    const settings = this.readSettings();
    const play = (settings.enabled || !!input?.preview) && settings.volume > 0;
    if (!play) return { play: false, volume: settings.volume };
    const saved = this.app.storeManager.get('completionSound');
    if (!saved?.directory || !saved.files?.length)
      return { builtin: settings.builtin, play, volume: settings.volume };
    const candidates =
      saved.files.length > 1
        ? saved.files.filter(({ file }) => file !== this.lastFile)
        : saved.files;
    const sound = candidates[Math.floor(Math.random() * candidates.length)];
    const data = await readFile(pathUtils.join(saved.directory, sound.file));
    this.lastFile = sound.file;
    return {
      dataUrl: `data:${sound.mime};base64,${data.toString('base64')}`,
      play,
      volume: settings.volume,
    };
  }

  private readSettings(): CompletionSoundSettings {
    const settings = this.app.storeManager.get('completionSound');
    return {
      builtin: settings?.builtin ?? 'lobehub',
      enabled: settings?.enabled ?? false,
      name: settings?.name,
      notificationSound: settings?.notificationSound ?? 'system',
      volume: settings?.volume ?? 0.7,
    };
  }

  private async isSystemSoundDisabled(): Promise<boolean> {
    if (!macOS()) return false;
    try {
      const { getSoundSetting } = await import('@lobechat/electron-mac-notifications');
      return (await getSoundSetting()) === 'disabled';
    } catch (error) {
      console.error('Failed to read macOS notification sound setting:', error);
      return false;
    }
  }

  private async removeImportedDirectory(directory: string) {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch (error) {
      console.error('Failed to remove old completion sounds:', error);
    }
  }
}
