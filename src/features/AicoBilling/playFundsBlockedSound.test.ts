import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FUNDS_BLOCKED_SOUND_URL,
  playFundsBlockedSound,
  resetFundsBlockedSoundForTests,
} from './playFundsBlockedSound';

class MockAudio {
  static instances: MockAudio[] = [];

  currentTime = 0;
  ended = false;
  paused = true;
  src: string;
  play = vi.fn(() => {
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }
}

describe('playFundsBlockedSound', () => {
  beforeEach(() => {
    MockAudio.instances = [];
    resetFundsBlockedSoundForTests();
    vi.stubGlobal('Audio', MockAudio);
  });

  afterEach(() => {
    resetFundsBlockedSoundForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates Audio with the pool-vade public URL and plays it', () => {
    playFundsBlockedSound();

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]?.src).toBe(FUNDS_BLOCKED_SOUND_URL);
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledTimes(1);
  });

  it('does not restart while the clip is already playing', () => {
    playFundsBlockedSound();
    playFundsBlockedSound();
    playFundsBlockedSound();

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledTimes(1);
  });

  it('replays after the previous play finished', () => {
    playFundsBlockedSound();
    const el = MockAudio.instances[0]!;
    el.paused = true;
    el.ended = true;

    playFundsBlockedSound();

    expect(el.currentTime).toBe(0);
    expect(el.play).toHaveBeenCalledTimes(2);
  });
});
