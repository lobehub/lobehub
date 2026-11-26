import { describe, expect, it } from 'vitest';

import { resolveDisabledIds, resolveImplicitMode } from './librarySkillPolicy';

describe('resolveDisabledIds', () => {
  it('lists a library skill the agent never turned on as disabled', () => {
    expect(resolveDisabledIds([], ['excalidraw', 'posthog'])).toEqual(['excalidraw', 'posthog']);
    expect(resolveDisabledIds(undefined, ['excalidraw'])).toEqual(['excalidraw']);
  });

  it('keeps a library skill the agent pinned or set to auto out of the disabled list', () => {
    expect(
      resolveDisabledIds(
        ['pinned-skill', { identifier: 'auto-skill', mode: 'auto' }],
        ['pinned-skill', 'auto-skill', 'untouched-skill'],
      ),
    ).toEqual(['untouched-skill']);
  });

  it('leaves tools and builtin skills on the explicit disabled entries only', () => {
    // `lobe-web-browsing` and `artifacts` are not library skills: no entry is Auto.
    expect(
      resolveDisabledIds([{ identifier: 'github', mode: 'disabled' }], ['excalidraw']),
    ).toEqual(['github', 'excalidraw']);
  });

  it('does not repeat a library skill that is also explicitly disabled', () => {
    expect(
      resolveDisabledIds([{ identifier: 'excalidraw', mode: 'disabled' }], ['excalidraw']),
    ).toEqual(['excalidraw']);
  });
});

describe('resolveImplicitMode', () => {
  it('is disabled for a library skill and auto for everything else', () => {
    const librarySkillIds = new Set(['excalidraw']);

    expect(resolveImplicitMode('excalidraw', librarySkillIds)).toBe('disabled');
    expect(resolveImplicitMode('artifacts', librarySkillIds)).toBe('auto');
  });
});
