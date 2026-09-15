import type {
  CompletionBuiltinSound,
  CompletionSoundPlayback,
  CompletionSoundSettings,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

const BUILTIN_FILES: Record<CompletionBuiltinSound, string> = {
  glassBell: '/sounds/glass-bell.wav',
  lobehub: '/sounds/chat-complete.wav',
  softTone: '/sounds/soft-tone.wav',
  xylophone: '/sounds/xylophone.wav',
};

class CompletionSoundService {
  private audio?: HTMLAudioElement;
  private playing?: Promise<void>;

  getSettings = () => ensureElectronIpc().completionSound.getSettings();

  setSettings = (settings: Partial<CompletionSoundSettings>) =>
    ensureElectronIpc().completionSound.setSettings(settings);

  importSound = () => ensureElectronIpc().completionSound.importSound();

  getNotificationSoundFile = () => ensureElectronIpc().completionSound.getNotificationSoundFile();

  /** Start audio once, even when several runs finish together. Resolves when playback starts. */
  play = async (options?: { preview?: boolean }): Promise<void> => {
    if (this.playing) return this.playing;
    if (this.audio && !this.audio.paused && !this.audio.ended) return;
    const start = async () => {
      const playback: CompletionSoundPlayback =
        await ensureElectronIpc().completionSound.getPlayback(options ?? {});
      if (!playback.play) return;
      this.audio = new Audio(playback.dataUrl ?? BUILTIN_FILES[playback.builtin ?? 'lobehub']);
      this.audio.volume = playback.volume;
      await this.audio.play();
    };
    this.playing = start();
    try {
      await this.playing;
    } finally {
      this.playing = undefined;
    }
  };
}

export const completionSoundService = new CompletionSoundService();
