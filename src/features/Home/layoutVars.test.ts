/* eslint-disable no-restricted-imports -- reads the stylesheet source it pins */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { homeLayoutVars, SPEECH_INLINE_MIN } from './layoutVars';

const css = readFileSync(path.resolve(__dirname, 'index.module.css'), 'utf8');

describe('home layout custom properties', () => {
  it('keeps the container-query threshold in step with the layout constants', () => {
    const thresholds = [...css.matchAll(/@container home \(width >= (\d+)px\)/g)].map((match) =>
      Number(match[1]),
    );

    expect(thresholds.length).toBeGreaterThan(0);
    for (const threshold of thresholds) expect(threshold).toBe(SPEECH_INLINE_MIN);
  });

  it('defines every custom property the stylesheet reads from the grid root', () => {
    const provided = new Set(Object.keys(homeLayoutVars));
    const used = new Set([...css.matchAll(/var\((--home-[a-z-]+)\)/g)].map((match) => match[1]));
    const definedInCss = new Set([...css.matchAll(/(--home-[a-z-]+):/g)].map((m) => m[1]));
    // Provided by the minimal layout or by the stylesheet itself.
    const external = new Set(['--home-minimal-lift']);

    for (const name of used) {
      if (definedInCss.has(name) || external.has(name)) continue;
      expect(provided.has(name), name).toBe(true);
    }
  });
});
