import { expect, it, vi } from 'vitest';

const submit = (draft: string, save: (value: string) => void) => {
  if (draft.trim()) save(draft.trim());
};

it('sends normalized content to the persistence boundary', () => {
  const save = vi.fn();
  submit(' hello ', save);
  expect(save).toHaveBeenCalledWith('hello');
});
