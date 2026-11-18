import { expect, it } from 'vitest';

const defaults = (settings?: { enabled?: boolean }) => ({ enabled: settings?.enabled ?? true });

it('uses the default for omitted settings', () => {
  expect(defaults(undefined)).toEqual({ enabled: true });
});

it('preserves an explicit opt-out', () => {
  expect(defaults({ enabled: false })).toEqual({ enabled: false });
});
