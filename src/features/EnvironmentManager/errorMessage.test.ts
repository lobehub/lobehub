import { describe, expect, it } from 'vitest';

import { describeError } from './errorMessage';

const t = (key: string) => `<${key}>`;

describe('describeError', () => {
  it('turns the has-instances refusal code into its sentence', () => {
    expect(describeError(new Error('ENVIRONMENT_HAS_INSTANCES'), t, 'fallback')).toBe(
      '<environments.hasInstances>',
    );
  });

  it('turns a path the server confined to the instance into the same line', () => {
    expect(describeError(new Error('PATH_OUTSIDE_INSTANCE'), t, 'fallback')).toBe(
      '<environments.files.invalidPath>',
    );
  });

  it('turns a path validation issue list into the localized line instead of raw JSON', () => {
    const issues = JSON.stringify([
      {
        code: 'custom',
        message: 'Path must be a relative path inside the workspace',
        path: ['path'],
      },
    ]);
    expect(describeError(new Error(issues), t, 'fallback')).toBe(
      '<environments.files.invalidPath>',
    );
  });

  it('joins other validation issues into one readable message', () => {
    const issues = JSON.stringify([
      {
        code: 'too_big',
        message: 'Too big: expected string to have <=1048576 characters',
        path: ['content'],
      },
    ]);
    expect(describeError(new Error(issues), t, 'fallback')).toBe(
      'Too big: expected string to have <=1048576 characters',
    );
  });

  it('keeps an ordinary message and falls back when there is none', () => {
    expect(describeError(new Error('could not delete'), t, 'fallback')).toBe('could not delete');
    expect(describeError({}, t, 'fallback')).toBe('fallback');
    expect(describeError(new Error('[not json'), t, 'fallback')).toBe('[not json');
  });
});
