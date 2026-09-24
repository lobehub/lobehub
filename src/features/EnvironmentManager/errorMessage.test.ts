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

  it('drops a drizzle query dump rather than showing SQL and row values', () => {
    // A missing column surfaced in the create dialog as a screenful of SQL with
    // the instance's own values in it; the caller's line at least says which
    // action failed.
    const drizzle = new Error(
      'Failed query: insert into "environment_instances" ("id", "name") values ' +
        '(default, $1) returning "id", "name" params: 7e3e4ab0,Lobehub Dev',
    );
    expect(describeError(drizzle, t, 'fallback')).toBe('fallback');
  });

  it('drops a message that dragged a stack trace along', () => {
    const stack = new Error('something broke\n    at Object.<anonymous> (/app/server.js:1:1)');
    expect(describeError(stack, t, 'fallback')).toBe('fallback');
  });

  it('keeps an ordinary message and falls back when there is none', () => {
    expect(describeError(new Error('could not delete'), t, 'fallback')).toBe('could not delete');
    expect(describeError({}, t, 'fallback')).toBe('fallback');
    expect(describeError(new Error('[not json'), t, 'fallback')).toBe('[not json');
  });
});
