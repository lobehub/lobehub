import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guard for agent share writes.
 *
 * Every write that sets `agentShares.visibility` (to `private` or otherwise)
 * or deletes an `agentShares` row must flow through the shared
 * generation-bump + `onShareReset` / `onShareRunsInterrupted` contract
 * (`bumpAgentShareGeneration`, `AgentShareModel`,
 * `writeAgentConfigWithShareReset`) — a bare `UPDATE`/`DELETE` leaves any
 * reservation staked, or operation already running, under the OLD generation
 * free to confirm/keep running after the share becomes unresolvable, with no
 * way for the visitor to stop it.
 *
 * This has bypassed the contract THREE separate times
 * (`writeAgentConfigWithShareReset`'s own reset, then
 * `AgentModel.transferAgents`, then `AgentGroupRepository.transferToWorkspace`)
 * — each fix closed only the site that had just been named, and a sibling
 * site kept the bug alive. This test does not verify the
 * CONTRACT itself is followed correctly (`agentShare.generation.test.ts` /
 * `agentShare.transferRace.test.ts` and friends do that) — it only makes sure
 * a FUTURE raw `agentShares` visibility/delete write cannot land silently: a
 * new file touching `agentShares` this way fails this test until a human adds
 * it to `ALLOWED_FILES` below (and, presumably, notices it needs the same
 * generation bump the existing ones have).
 */
const ALLOWED_FILES = new Set([
  // writeAgentConfigWithShareReset: bumps agentShareGenerations and invokes
  // onShareReset in the same transaction as the reset.
  'utils/agentConfigShareReset.ts',
  // AgentShareModel: the contract's own home (updateVisibility, updateConfig,
  // deleteByAgentId, create).
  'models/agentShare.ts',
  // AgentModel.transferAgents: resets a link share left behind by a personal
  // -> workspace move, bumping the generation and calling onShareReset.
  'models/agent.ts',
  // AgentGroupRepository.transferToWorkspace: same reset for a group-owned
  // agent's share.
  'repositories/agentGroup/index.ts',
]);

const SRC_ROOT = path.join(__dirname, '../../');

const RAW_WRITE_PATTERN = /\.update\(agentShares\)|\.delete\(agentShares\)/;

const listTsFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__') continue;

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('agentShares raw write guard', () => {
  it('every raw agentShares visibility/delete write lives in an audited file', () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(SRC_ROOT)) {
      const relativePath = path.relative(SRC_ROOT, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(relativePath)) continue;

      const content = readFileSync(file, 'utf8');
      if (RAW_WRITE_PATTERN.test(content)) offenders.push(relativePath);
    }

    expect(offenders).toEqual([]);
  });
});
