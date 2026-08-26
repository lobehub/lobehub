// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./agentShare.ts', import.meta.url), 'utf8');

describe('AgentShareModel mutation locking', () => {
  it('locks the owned Agent row before every share mutation', () => {
    expect(source).toContain(".for('update')");
    // create, updateConfig, updateVisibility, deleteByAgentId, and
    // assertRunnableForVisitor (LOBE-11930 hole 1's visitor-start recheck).
    expect(source.match(/this\.withOwnedPersonalAgentLock\(/g)).toHaveLength(5);
  });
});
