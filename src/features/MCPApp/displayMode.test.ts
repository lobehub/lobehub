import { describe, expect, it } from 'vitest';

import { availableDisplayModes, requestedDisplayMode, resolveDisplayMode } from './displayMode';

const both = ['inline', 'fullscreen'] as const;
describe('MCP App display mode negotiation', () => {
  it('prioritizes tool, then resource, then dual-mode fullscreen', () => {
    const base = {
      hostModes: both,
      resourceMeta: {
        availableDisplayModes: [...both],
        preferredDisplayMode: 'fullscreen' as const,
      },
    };
    expect(resolveDisplayMode({ ...base, toolPreferred: 'inline' })).toBe('inline');
    expect(resolveDisplayMode(base)).toBe('fullscreen');
    expect(
      resolveDisplayMode({ hostModes: both, resourceMeta: { availableDisplayModes: [...both] } }),
    ).toBe('fullscreen');
    expect(resolveDisplayMode({ hostModes: both })).toBe('inline');
  });
  it('intersects all capabilities and never supports PiP', () => {
    expect(resolveDisplayMode({ hostModes: ['inline'], toolPreferred: 'fullscreen' })).toBe(
      'inline',
    );
    expect(
      resolveDisplayMode({ hostModes: both, appModes: ['inline'], toolPreferred: 'fullscreen' }),
    ).toBe('inline');
    expect(
      availableDisplayModes({
        hostModes: both,
        resourceMeta: { availableDisplayModes: ['fullscreen'] },
        appModes: ['inline'],
      }),
    ).toEqual([]);
    expect(
      requestedDisplayMode('inline', 'pip', { hostModes: ['inline', 'fullscreen', 'pip'] }),
    ).toBe('inline');
    expect(
      requestedDisplayMode('fullscreen', 'inline', { hostModes: both, appModes: ['fullscreen'] }),
    ).toBe('fullscreen');
    expect(requestedDisplayMode('inline', 'fullscreen', { hostModes: both, appModes: both })).toBe(
      'fullscreen',
    );
  });
});
