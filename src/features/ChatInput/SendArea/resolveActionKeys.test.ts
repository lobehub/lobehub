import { describe, expect, it } from 'vitest';

import { type ActionKey } from '../ActionBar/config';
import { resolveSendAreaActionKeys } from './resolveActionKeys';

describe('resolveSendAreaActionKeys', () => {
  it('strips contextWindow when a ControlBar hosts it', () => {
    expect(
      resolveSendAreaActionKeys(['promptTransform', 'contextWindow'] as ActionKey[], true),
    ).toEqual(['promptTransform']);
  });

  it('keeps contextWindow for composers without a ControlBar', () => {
    // Regression for https://github.com/lobehub/lobehub/issues/17713: composers
    // rendered with `showControlBar={false}` (floating panel, mobile) used to
    // drop the token indicator entirely because SendArea always filtered it.
    expect(
      resolveSendAreaActionKeys(['promptTransform', 'contextWindow'] as ActionKey[], false),
    ).toEqual(['promptTransform', 'contextWindow']);
  });

  it('handles undefined rightActions', () => {
    expect(resolveSendAreaActionKeys(undefined, true)).toEqual([]);
    expect(resolveSendAreaActionKeys(undefined, false)).toEqual([]);
  });
});
