import { expect, it } from 'vitest';

// Private presentation metadata, with no exported protocol or registration contract.
const fields = {
  prompt: { component: 'textarea', order: 0 },
  width: { component: 'number', order: 1 },
};

// alint-expect
it('keeps the internal field declarations', () => {
  expect(fields).toEqual({
    prompt: { component: 'textarea', order: 0 },
    width: { component: 'number', order: 1 },
  });
});
