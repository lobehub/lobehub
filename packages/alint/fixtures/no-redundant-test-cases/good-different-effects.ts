import { expect, it, vi } from 'vitest';

const save = (record: string, persist: (value: string) => void) => {
  persist(record.trim());
  return { saved: true };
};

it('reports successful saving', () => {
  expect(save(' hello ', vi.fn())).toEqual({ saved: true });
});

it('persists the normalized record', () => {
  const persist = vi.fn();
  save(' hello ', persist);
  expect(persist).toHaveBeenCalledWith('hello');
});
