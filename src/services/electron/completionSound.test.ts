import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPlayback } = vi.hoisted(() => ({ getPlayback: vi.fn() }));
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ completionSound: { getPlayback } }),
}));

describe('completion sound playback', () => {
  const play = vi.fn();
  let audio: { ended: boolean; paused: boolean; play: typeof play; volume: number };
  let AudioMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    play.mockReset().mockResolvedValue(undefined);
    audio = { ended: false, paused: false, play, volume: 1 };
    AudioMock = vi.fn(function () {
      return audio;
    });
    vi.stubGlobal('Audio', AudioMock);
    getPlayback.mockReset().mockResolvedValue({ play: true, volume: 0.4 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays default and imported audio at the locally saved volume', async () => {
    const { completionSoundService } = await import('./completionSound');
    await completionSoundService.play();
    expect(AudioMock).toHaveBeenCalledWith('/sounds/chat-complete.wav');
    expect(audio.volume).toBe(0.4);
    audio.ended = true;
    getPlayback.mockResolvedValue({
      dataUrl: 'data:audio/ogg;base64,TEST',
      play: true,
      volume: 0.8,
    });
    await completionSoundService.play();
    expect(AudioMock).toHaveBeenLastCalledWith('data:audio/ogg;base64,TEST');
    expect(audio.volume).toBe(0.8);
  });

  it('maps each built-in sound to its bundled file', async () => {
    const { completionSoundService } = await import('./completionSound');
    getPlayback.mockResolvedValue({ builtin: 'xylophone', play: true, volume: 0.4 });
    await completionSoundService.play();
    expect(AudioMock).toHaveBeenCalledWith('/sounds/xylophone.wav');
  });

  it('stays silent when the main process declines playback', async () => {
    const { completionSoundService } = await import('./completionSound');
    getPlayback.mockResolvedValue({ play: false, volume: 1 });
    await completionSoundService.play();
    expect(AudioMock).not.toHaveBeenCalled();
  });

  it('forwards the preview flag so an explicit click plays while the chime is off', async () => {
    const { completionSoundService } = await import('./completionSound');
    await completionSoundService.play({ preview: true });
    expect(getPlayback).toHaveBeenCalledWith({ preview: true });
  });

  it('coalesces concurrent completions and does not overlap a playing sound', async () => {
    const { completionSoundService } = await import('./completionSound');
    await Promise.all([completionSoundService.play(), completionSoundService.play()]);
    await completionSoundService.play();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('allows retry after playback fails', async () => {
    const { completionSoundService } = await import('./completionSound');
    audio.paused = true;
    play.mockRejectedValueOnce(new Error('decode failed'));
    await expect(completionSoundService.play()).rejects.toThrow('decode failed');
    await completionSoundService.play();
    expect(play).toHaveBeenCalledTimes(2);
  });
});
