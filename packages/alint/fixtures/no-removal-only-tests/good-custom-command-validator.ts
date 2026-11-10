import { expect, it } from 'vitest';

import { checkDocumentationCommand } from './modelFacingDocs';

it('detects a removed command in documentation using the custom validator', () => {
  expect(checkDocumentationCommand('lh config whoami')).toEqual(['unknown command lh config']);
  expect(checkDocumentationCommand('lh whoami --json')).toEqual([]);
});
