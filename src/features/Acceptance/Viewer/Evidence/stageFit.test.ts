import { describe, expect, it } from 'vitest';

import { resolveStageFit, stageContentBox, TALL_IMAGE_ASPECT } from './stageFit';

const stage = { height: 400, width: 600 };

describe('resolveStageFit', () => {
  it('returns nothing until both boxes are measured', () => {
    expect(resolveStageFit({ natural: undefined, stage })).toBeUndefined();
    expect(
      resolveStageFit({ natural: { height: 800, width: 1280 }, stage: undefined }),
    ).toBeUndefined();
    expect(resolveStageFit({ natural: { height: 0, width: 1280 }, stage })).toBeUndefined();
    expect(
      resolveStageFit({ natural: { height: 800, width: 1280 }, stage: { height: 0, width: 600 } }),
    ).toBeUndefined();
  });

  it('fits a landscape screenshot to the stage width', () => {
    expect(resolveStageFit({ natural: { height: 1000, width: 1600 }, stage })).toEqual({
      height: 375,
      mode: 'contain',
      scale: 0.375,
      tall: false,
      width: 600,
    });
  });

  it('fits a phone screenshot to the stage height and leaves side bands', () => {
    const fit = resolveStageFit({ natural: { height: 1950, width: 900 }, stage })!;
    expect(fit.mode).toBe('contain');
    expect(fit.tall).toBe(false);
    expect(fit.height).toBe(400);
    expect(fit.width).toBe(184);
  });

  it('shows a small crop at its natural size instead of scaling it up', () => {
    expect(resolveStageFit({ natural: { height: 120, width: 320 }, stage })).toEqual({
      height: 120,
      mode: 'contain',
      scale: 1,
      tall: false,
      width: 320,
    });
  });

  it('fits a full-page capture to the width and lets it scroll', () => {
    expect(resolveStageFit({ natural: { height: 4800, width: 1200 }, stage })).toEqual({
      height: 2400,
      mode: 'scroll',
      scale: 0.5,
      tall: true,
      width: 600,
    });
  });

  it('never scales a narrow full-page capture above its natural width', () => {
    const fit = resolveStageFit({ natural: { height: 2412, width: 390 }, stage })!;
    expect(fit).toMatchObject({ height: 2412, mode: 'scroll', scale: 1, width: 390 });
  });

  it('contains a full-page capture once fit height is chosen, and keeps the toggle', () => {
    const fit = resolveStageFit({
      fitHeight: true,
      natural: { height: 4800, width: 1200 },
      stage,
    })!;
    expect(fit).toMatchObject({ height: 400, mode: 'contain', tall: true, width: 100 });
  });

  it('does not scroll a tall image that already fits the stage', () => {
    const fit = resolveStageFit({ natural: { height: 390, width: 100 }, stage })!;
    expect(fit).toMatchObject({ height: 390, mode: 'contain', tall: false, width: 100 });
  });

  it('treats the aspect threshold itself as a phone screen, not a full page', () => {
    const fit = resolveStageFit({
      natural: { height: 1000 * TALL_IMAGE_ASPECT, width: 1000 },
      stage,
    })!;
    expect(fit.mode).toBe('contain');
  });

  it('gives the same mode for the same picture at any pixel density', () => {
    const at1x = resolveStageFit({ natural: { height: 844, width: 390 }, stage })!;
    const at3x = resolveStageFit({ natural: { height: 2532, width: 1170 }, stage })!;
    expect(at1x.mode).toBe('contain');
    expect(at3x.mode).toBe('contain');
  });
});

describe('stageContentBox', () => {
  it('subtracts the stage padding from the measured box', () => {
    expect(
      stageContentBox({ height: 480, width: 800 }, { bottom: 68, left: 16, right: 16, top: 16 }),
    ).toEqual({ height: 396, width: 768 });
  });

  it('is unmeasured while either side is missing or swallowed by padding', () => {
    const padding = { bottom: 16, left: 16, right: 16, top: 16 };
    expect(stageContentBox({ height: undefined, width: 800 }, padding)).toBeUndefined();
    expect(stageContentBox({ height: 480, width: undefined }, padding)).toBeUndefined();
    expect(stageContentBox({ height: 24, width: 800 }, padding)).toBeUndefined();
  });
});
