import { describe, expect, it } from 'vitest';

import { RenderProfileRecorder } from './recorder';

const createRecorder = () => {
  let now = 0;
  const recorder = new RenderProfileRecorder(() => now);
  return {
    recorder,
    setNow: (value: number) => {
      now = value;
    },
  };
};

describe('RenderProfileRecorder', () => {
  it('aggregates renders per region and counts distinct commits', () => {
    const { recorder, setNow } = createRecorder();
    recorder.begin('switch');

    // One commit touching both nested regions, then an update of the sidebar alone.
    recorder.recordRender('messages', 'mount', 4, 10);
    recorder.recordRender('conversation', 'mount', 6, 10);
    recorder.recordRender('sidebar', 'update', 1.234, 20);
    recorder.recordRender('sidebar', 'nested-update', 2, 30);
    setNow(50);

    const report = recorder.end();

    expect(report).toMatchObject({ commitCount: 3, durationMs: 50, label: 'switch' });
    expect(report.regions.sidebar).toEqual({
      actualDurationMs: 3.23,
      maxActualDurationMs: 2,
      mounts: 0,
      renders: 2,
      updates: 2,
    });
    expect(report.regions.messages).toMatchObject({ mounts: 1, renders: 1, updates: 0 });
    expect(report.regions.conversation.actualDurationMs).toBe(6);
  });

  it('reports the longest gap between animation frames', () => {
    const { recorder } = createRecorder();
    recorder.begin('switch');

    for (const timestamp of [0, 16, 33, 120, 136]) recorder.recordAnimationFrame(timestamp);
    recorder.recordLongAnimationFrame(80);
    recorder.recordLongAnimationFrame(60);

    expect(recorder.end()).toMatchObject({
      frames: { count: 5, maxGapMs: 87 },
      longestAnimationFrameMs: 80,
    });
  });

  it('ignores samples outside a scenario and starts each scenario from zero', () => {
    const { recorder } = createRecorder();
    recorder.recordRender('sidebar', 'update', 5, 1);
    recorder.recordAnimationFrame(0);

    recorder.begin('first');
    recorder.recordRender('sidebar', 'update', 5, 2);
    recorder.end();

    recorder.recordRender('sidebar', 'update', 5, 3);
    recorder.begin('second');

    expect(recorder.end()).toMatchObject({
      commitCount: 0,
      frames: { count: 0, maxGapMs: 0 },
      regions: { sidebar: { renders: 0 } },
    });
  });

  it('exposes the latest commit time while a scenario is active', () => {
    const { recorder, setNow } = createRecorder();
    recorder.begin('switch');
    setNow(42);
    recorder.recordRender('messages', 'update', 1, 7);

    expect(recorder.status()).toEqual({
      active: true,
      commitCount: 1,
      frameCount: 0,
      label: 'switch',
      lastCommitAt: 42,
    });
  });

  it('rejects overlapping scenarios and ending without one', () => {
    const { recorder } = createRecorder();

    expect(() => recorder.end()).toThrow('No render profile is active');

    recorder.begin('boot');
    expect(() => recorder.begin('switch')).toThrow('"boot" is still active');
  });
});
