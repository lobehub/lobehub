import { describe, expect, it } from 'vitest';

import { getCiVisual } from '@/features/AgentSidebar/Topic/List/Item/metaCardData';

import { statusTint } from '../statusTint';

describe('statusTint', () => {
  it('mixes the status color into the chip background', () => {
    const { color } = getCiVisual('failure');

    expect(statusTint(color)).toBe(`color-mix(in srgb, ${color} 14%, transparent)`);
  });
});
