import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { type ExecutionPlan } from '@/helpers/executionTarget';

import type { AgentShareGate } from '../shareGate';
import { applyShareVisitorSandboxOverride } from './toolDiscovery';

const buildGate = (enabledToolIds: string[]): AgentShareGate => ({
  agentId: 'agent-1',
  shareConfig: {
    enabledToolIds,
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
  },
  shareId: 'share-1',
  visitorUserId: 'visitor-1',
});

const nonePlan: ExecutionPlan = { kind: 'none', target: 'none' };
const sandboxPlan: ExecutionPlan = { kind: 'sandbox', target: 'sandbox' };

describe('applyShareVisitorSandboxOverride', () => {
  it('leaves the plan untouched for a non-share run', () => {
    expect(applyShareVisitorSandboxOverride(nonePlan, undefined, undefined)).toBe(nonePlan);
  });

  it('leaves the plan untouched when the share does not grant lobe-cloud-sandbox', () => {
    const gate = buildGate(['web-search']);

    expect(applyShareVisitorSandboxOverride(nonePlan, gate, undefined)).toBe(nonePlan);
  });

  // The creator's agent may target `local`/`auto`, which `resolveExecutionPlan`
  // collapses to `{ kind: 'none' }` for a share visitor (who can never reach a
  // device) — this is the exact scenario the override exists to fix.
  it('forces the plan to sandbox when the share grants lobe-cloud-sandbox and the plan degraded to none', () => {
    const gate = buildGate([CloudSandboxManifest.identifier]);

    expect(applyShareVisitorSandboxOverride(nonePlan, gate, undefined)).toEqual(sandboxPlan);
  });

  it('recognizes a per-API grant entry as a grant of the whole identifier', () => {
    const gate = buildGate([`${CloudSandboxManifest.identifier}____runCommand`]);

    expect(applyShareVisitorSandboxOverride(nonePlan, gate, undefined)).toEqual(sandboxPlan);
  });

  it('leaves an already-sandboxed plan alone', () => {
    const gate = buildGate([CloudSandboxManifest.identifier]);

    expect(applyShareVisitorSandboxOverride(sandboxPlan, gate, undefined)).toBe(sandboxPlan);
  });

  // Chat mode means "no tools", not "no device" — a share run explicitly put
  // in chat mode must still resolve to `none` even with the grant.
  it('does not override chat mode', () => {
    const gate = buildGate([CloudSandboxManifest.identifier]);

    expect(applyShareVisitorSandboxOverride(nonePlan, gate, { enableAgentMode: false })).toBe(
      nonePlan,
    );
  });
});
