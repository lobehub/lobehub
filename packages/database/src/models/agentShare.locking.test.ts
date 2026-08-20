// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./agentShare.ts', import.meta.url), 'utf8');

describe('AgentShareModel mutation locking', () => {
  it('locks the owned Agent row before every share mutation', () => {
    expect(source).toContain(".for('update')");
    expect(source.match(/this\.withOwnedPersonalAgentLock\(/g)).toHaveLength(4);
  });
});
