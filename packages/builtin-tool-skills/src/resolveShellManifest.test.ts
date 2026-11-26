import { describe, expect, it } from 'vitest';

import { SkillsManifest } from './manifest';
import { resolveSkillsManifest } from './resolveManifest';
import { resolveSkillsRestrictedManifest } from './resolveRestrictedManifest';
import { resolveSkillsShellManifest } from './resolveShellManifest';
import { AGENT_SHARE_SKILL_API_NAMES, SkillsApiName } from './types';

const apiNames = (manifest: { api: { name: string }[] } | undefined) =>
  manifest?.api.map(({ name }) => name);

describe('resolveSkillsShellManifest', () => {
  it('keeps the sandbox shell and file export, and drops the APIs that need a skill', () => {
    const shell = resolveSkillsShellManifest(SkillsManifest)!;

    expect(apiNames(shell)).toEqual([SkillsApiName.runCommand, SkillsApiName.exportFile]);
    expect(shell.identifier).toBe(SkillsManifest.identifier);
  });

  it('describes only the offered APIs and keeps the sandbox workspace placeholder', () => {
    const { systemRole } = resolveSkillsShellManifest(SkillsManifest)!;

    expect(systemRole).toContain('**runCommand**');
    expect(systemRole).toContain('**exportFile**');
    expect(systemRole).toContain('{{sandbox_workspace}}');
    expect(systemRole).not.toContain('activateSkill');
    expect(systemRole).not.toContain('readReference');
    expect(systemRole).not.toContain('execScript');
  });

  it('carries over what the execution environment resolved', () => {
    const resolved = resolveSkillsManifest({
      executionEnv: 'device-unrouted',
      executionEnvUnroutedReason: 'bound-device-offline',
    })!;
    const shell = resolveSkillsShellManifest(resolved)!;

    expect(shell.api.find(({ name }) => name === SkillsApiName.runCommand)?.description).toMatch(
      /^Fallback execution environment/,
    );
    expect(shell.systemRole).toContain(
      '<execution_environment>\nBound device offline; shell commands execute in the cloud sandbox this run.\n</execution_environment>',
    );
  });

  it('keeps only exportFile in page scope, without the runCommand instructions', () => {
    const shell = resolveSkillsShellManifest(resolveSkillsManifest({ scope: 'page' })!)!;

    expect(apiNames(shell)).toEqual([SkillsApiName.exportFile]);
    expect(shell.systemRole).not.toContain('runCommand');
    expect(shell.systemRole).not.toContain('{{sandbox_workspace}}');
  });

  it.each(['device', 'local'] as const)(
    'has nothing to offer on a routed device (%s)',
    (executionEnv) => {
      expect(resolveSkillsShellManifest(resolveSkillsManifest({ executionEnv })!)).toBeUndefined();
    },
  );

  it('has nothing to offer on the Agent Share surface', () => {
    const shared = resolveSkillsRestrictedManifest({
      allowedApiNames: [...AGENT_SHARE_SKILL_API_NAMES],
      restriction: 'agentShare',
    })!;

    expect(resolveSkillsShellManifest(shared)).toBeUndefined();
  });
});
