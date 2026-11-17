import { expect, it } from 'vitest';

const buildQuery = (tag: string) => ({ query: `tag:${tag}` });

// alint-expect
it('builds the expected tag query', () => {
  const expected = buildQuery('urgent');
  expect(buildQuery('urgent')).toEqual(expected);
});
