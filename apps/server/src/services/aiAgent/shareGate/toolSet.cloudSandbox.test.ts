import {
  CloudSandboxIdentifier,
  shareVisitorSystemPrompt,
  systemPrompt as cloudSandboxSystemPrompt,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { applyShareGateToToolSet } from '.';
import { buildGate, buildToolSet } from './testUtils';

describe('applyShareGateToToolSet — lobe-cloud-sandbox', () => {
  const buildSandboxToolSet = (systemRole?: string) => {
    const toolSet = buildToolSet([
      { apis: [{ name: 'runCommand' }], identifier: CloudSandboxIdentifier },
    ]);
    toolSet.manifestMap[CloudSandboxIdentifier].systemRole = systemRole;
    return toolSet;
  };

  const gate = buildGate({ toolGrants: [{ identifier: CloudSandboxIdentifier }] });

  it('tells the model up front that lh is unavailable, keeping the default guidance', () => {
    const toolSet = buildSandboxToolSet(cloudSandboxSystemPrompt);

    applyShareGateToToolSet(toolSet, gate);

    const { systemRole } = toolSet.manifestMap[CloudSandboxIdentifier];
    expect(systemRole).toBe(`${cloudSandboxSystemPrompt}\n\n${shareVisitorSystemPrompt}`);
    expect(systemRole).toContain('`lh`');
  });

  it('still adds the notice when the manifest carries no systemRole', () => {
    const toolSet = buildSandboxToolSet();

    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.manifestMap[CloudSandboxIdentifier].systemRole).toBe(shareVisitorSystemPrompt);
  });

  it('does not repeat the notice when the gate runs again', () => {
    const toolSet = buildSandboxToolSet(cloudSandboxSystemPrompt);

    applyShareGateToToolSet(toolSet, gate);
    applyShareGateToToolSet(toolSet, gate);

    expect(toolSet.manifestMap[CloudSandboxIdentifier].systemRole).toBe(
      `${cloudSandboxSystemPrompt}\n\n${shareVisitorSystemPrompt}`,
    );
  });

  it('adds nothing when the sandbox is not granted', () => {
    const toolSet = buildSandboxToolSet(cloudSandboxSystemPrompt);

    applyShareGateToToolSet(toolSet, buildGate({ toolGrants: [] }));

    expect(toolSet.manifestMap[CloudSandboxIdentifier]).toBeUndefined();
  });
});
