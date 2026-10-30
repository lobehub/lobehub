import { describe, expect, it } from 'vitest';

import type { StyleSnapshot } from './capture';
import { compareSnapshots } from './capture';

const snapshot = (style: Record<string, string> = {}, box = [0, 0, 100, 40]): StyleSnapshot => ({
  animations: [],
  durationMs: 0,
  nodes: [{ box, key: 'root.0', scroll: [100, 40, 100, 40], style: 0, tag: 'DIV', text: 'Text' }],
  propertyReads: Object.keys(style).length,
  styles: [style],
});

describe('component style snapshot comparison', () => {
  it('compares properties independently of declaration order', () => {
    expect(
      compareSnapshots(
        snapshot({ color: 'red', opacity: '1' }),
        snapshot({ opacity: '1', color: 'red' }),
      ),
    ).toEqual([]);
  });
  it('detects removed properties and generated pseudo-elements', () => {
    const before = snapshot({ color: 'red' });
    before.nodes.push({ ...before.nodes[0], key: 'root.0::before' });
    expect(compareSnapshots(before, snapshot())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'color' }),
        expect.objectContaining({ key: 'root.0::before', property: 'node' }),
      ]),
    );
  });
  it('allows only bounded subpixel geometry noise', () => {
    expect(compareSnapshots(snapshot(), snapshot({}, [0, 0, 100.04, 40]))).toEqual([]);
    expect(compareSnapshots(snapshot(), snapshot({}, [0, 0, 100.1, 40]))).toEqual([
      expect.objectContaining({ property: 'box' }),
    ]);
  });
  it('retains but annotates inactive legacy flex differences', () => {
    const differences = compareSnapshots(
      snapshot({ '-webkit-box-align': 'center', 'display': 'flex' }),
      snapshot({ '-webkit-box-align': 'stretch', 'display': 'flex' }),
    );
    expect(differences).toHaveLength(1);
    expect(differences[0].diagnosticReason).toContain('inactive');
  });
  it('does not suppress legacy flex differences when either side uses that layout', () => {
    expect(
      compareSnapshots(
        snapshot({ '-webkit-box-align': 'center', 'display': '-webkit-box' }),
        snapshot({ '-webkit-box-align': 'stretch', 'display': '-webkit-box' }),
      )[0].diagnosticReason,
    ).toBeUndefined();
  });
  it('annotates only nonpainting border colors', () => {
    const border = {
      'border-top-color': 'red',
      'border-top-style': 'none',
      'border-top-width': '0px',
    };
    expect(
      compareSnapshots(snapshot(border), snapshot({ ...border, 'border-top-color': 'blue' }))[0]
        .diagnosticReason,
    ).toContain('nonpainting');
    expect(
      compareSnapshots(
        snapshot({ ...border, 'border-top-style': 'solid', 'border-top-width': '2px' }),
        snapshot({
          ...border,
          'border-top-color': 'blue',
          'border-top-style': 'solid',
          'border-top-width': '2px',
        }),
      )[0].diagnosticReason,
    ).toBeUndefined();
  });
  it('keeps custom-property diagnostics and their resolved rendering changes', () => {
    const differences = compareSnapshots(
      snapshot({ '--color': 'red', 'color': 'red' }),
      snapshot({ '--color': 'blue', 'color': 'blue' }),
    );
    expect(
      differences.find((difference) => difference.property === '--color')?.diagnosticReason,
    ).toContain('resolved');
    expect(
      differences.find((difference) => difference.property === 'color')?.diagnosticReason,
    ).toBeUndefined();
  });
  it('compares animation timing even at an identical first frame', () => {
    const before = snapshot();
    const after = snapshot();
    before.animations = [
      { key: 'root.0', keyframes: [{ opacity: 1 }], timing: { duration: 1000 } },
    ];
    after.animations = [{ key: 'root.0', keyframes: [{ opacity: 1 }], timing: { duration: 2000 } }];
    expect(compareSnapshots(before, after)).toEqual([
      expect.objectContaining({ property: 'animation-effects' }),
    ]);
  });
});
