import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import spend from './spend';

/**
 * The spend breakdown renders one filter entry per `RequestTrigger`, so a
 * trigger added without a label here is a type error — in the consumer that
 * enumerates the enum, which is not in this repository. Adding
 * `RequestTrigger.Scm` broke the Cloud build that way, with every check
 * here green.
 *
 * Read from the enum source rather than importing it: this package does not
 * depend on `@lobechat/types`, and the guard is about the text of the enum,
 * not its runtime value.
 */
const TRIGGER_ENUM = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'types',
  'src',
  'agentRuntime.ts',
);

const triggerValues = () => {
  const source = readFileSync(TRIGGER_ENUM, 'utf8');
  const block = /export enum RequestTrigger \{([^}]*)\}/.exec(source)?.[1];
  if (!block) throw new Error('RequestTrigger enum not found in agentRuntime.ts');
  return [...block.matchAll(/^\s*\w+ = '([^']+)',/gm)].map(([, value]) => value);
};

describe('spend locale', () => {
  it('labels every request trigger', () => {
    const values = triggerValues();
    expect(values.length).toBeGreaterThan(10);

    const missing = values.filter((value) => !(`table.columns.trigger.enums.${value}` in spend));
    expect(missing).toEqual([]);
  });
});
