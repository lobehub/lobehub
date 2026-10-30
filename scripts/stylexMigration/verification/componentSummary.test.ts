import { expect, it } from 'vitest';

import { sampledStyleStatus } from './componentSummary';

const equal = { aaStable: true, comparison: { differences: [], review: [] }, confirmed: false };
it('qualifies equality and never treats zero execution as equal', () => {
  expect(sampledStyleStatus([equal], [], false)).toBe('EQUAL_IN_SAMPLES');
  expect(sampledStyleStatus([], [], false)).toBe('NOT_RUN');
  expect(sampledStyleStatus([equal], [], true)).toBe('INCOMPLETE');
});
it('retains a confirmed difference when later samples are missing', () => {
  const different = {
    ...equal,
    comparison: { differences: ['color'], review: [] },
    confirmed: true,
  };
  expect(sampledStyleStatus([different], [], true)).toBe('DIFFERENT');
  expect(sampledStyleStatus([different], ['PAGE_ERROR'], false)).toBe('ERROR');
});
it('does not promote unstable, unconfirmed or custom-property-only results', () => {
  expect(sampledStyleStatus([{ ...equal, aaStable: false }], [], false)).toBe('UNSTABLE');
  expect(
    sampledStyleStatus(
      [{ ...equal, comparison: { differences: ['color'], review: [] } }],
      [],
      false,
    ),
  ).toBe('NEEDS_REVIEW');
  expect(
    sampledStyleStatus(
      [{ ...equal, comparison: { differences: [], review: ['--unknown'] } }],
      [],
      false,
    ),
  ).toBe('NEEDS_REVIEW');
});
