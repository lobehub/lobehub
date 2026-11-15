import { describe, expect, it } from 'vitest';

import { frameLevel, LiveWindowCutter } from './liveWindows';

const frame = (amplitude: number, samples = 3200) =>
  new Int16Array(samples).fill(Math.round(amplitude * 32_767)).buffer;

const speech = () => frame(0.2);
const silence = () => frame(0);

describe('frameLevel', () => {
  it('measures RMS on a 0…1 scale', () => {
    expect(frameLevel(silence())).toBe(0);
    expect(frameLevel(frame(0.5))).toBeCloseTo(0.5, 2);
    expect(frameLevel(new ArrayBuffer(0))).toBe(0);
  });
});

describe('LiveWindowCutter', () => {
  const options = { frameMs: 200, maxMs: 2000, minMs: 1000, silenceLevel: 0.01 };

  it('cuts at the first silent frame once the minimum length is reached', () => {
    const cutter = new LiveWindowCutter(options);
    for (let index = 0; index < 4; index++) expect(cutter.push(speech())).toBeUndefined();

    // 1000 ms reached on a voiced frame: keep going until a pause in speech.
    expect(cutter.push(speech())).toBeUndefined();
    const window = cutter.push(silence());

    expect(window).toMatchObject({ endMs: 1200, startMs: 0, voiced: true });
    expect(window?.frames).toHaveLength(6);
  });

  it('cuts at the maximum length even without a pause', () => {
    const cutter = new LiveWindowCutter(options);
    let window;
    for (let index = 0; index < 10; index++) window = cutter.push(speech()) ?? window;

    expect(window).toMatchObject({ endMs: 2000, startMs: 0 });
  });

  it('continues the timeline across windows and marks silent ones unvoiced', () => {
    const cutter = new LiveWindowCutter(options);
    for (let index = 0; index < 5; index++) cutter.push(silence());
    const next = (() => {
      for (let index = 0; index < 3; index++) cutter.push(speech());
      return cutter.flush();
    })();

    expect(next).toMatchObject({ endMs: 1600, startMs: 1000, voiced: true });
  });

  it('flushes the open window on pause and nothing when empty', () => {
    const cutter = new LiveWindowCutter(options);
    cutter.push(speech());
    expect(cutter.flush()).toMatchObject({ endMs: 200, startMs: 0 });
    expect(cutter.flush()).toBeUndefined();
  });

  it('marks a window of pure silence as unvoiced', () => {
    const cutter = new LiveWindowCutter(options);
    let window;
    for (let index = 0; index < 5; index++) window = cutter.push(silence()) ?? window;
    expect(window).toMatchObject({ voiced: false });
  });
});
