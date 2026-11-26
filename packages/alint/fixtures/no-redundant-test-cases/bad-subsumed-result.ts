import { expect, it } from 'vitest';

const defaults = (settings?: { enabled?: boolean }) => ({
  enabled: settings?.enabled ?? true,
  mode: 'quiet',
});

it('creates all defaults when settings are omitted', () => {
  expect(defaults(undefined)).toEqual({ enabled: true, mode: 'quiet' });
});

// alint-expect
it('enables an item when settings are omitted', () => {
  expect(defaults(undefined).enabled).toBe(true);
});
