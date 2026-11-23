import { describe, expect, it } from 'vitest';

import {
  agentShareSystemPrompt,
  resolveSkillsRestrictedManifest,
} from './resolveRestrictedManifest';
import { sharedSkillGuidelines } from './systemRole';
import { AGENT_SHARE_SKILL_API_NAMES, SkillsApiName } from './types';

describe('resolveSkillsRestrictedManifest', () => {
  it('returns the read-only manifest with the concise agentShareSystemPrompt', () => {
    const manifest = resolveSkillsRestrictedManifest({
      allowedApiNames: [...AGENT_SHARE_SKILL_API_NAMES],
      restriction: 'agentShare',
    });

    expect(manifest).toBeDefined();
    expect(manifest?.api.map((api) => api.name).sort()).toEqual(
      [SkillsApiName.activateSkill, SkillsApiName.readReference].sort(),
    );
    expect(manifest?.systemRole).toBe(agentShareSystemPrompt);
    expect(agentShareSystemPrompt).toContain(sharedSkillGuidelines);
    expect(agentShareSystemPrompt).toContain('<selected_skill_context>');
    expect(agentShareSystemPrompt).toContain('cannot run commands or scripts');
    for (const forbidden of [
      SkillsApiName.execScript,
      SkillsApiName.runCommand,
      SkillsApiName.exportFile,
      '{{sandbox_workspace}}',
      '<core_capabilities>',
    ]) {
      expect(agentShareSystemPrompt).not.toContain(forbidden);
    }
  });

  it('returns undefined for unsupported restrictions or API subsets (fail-closed)', () => {
    expect(
      resolveSkillsRestrictedManifest({
        allowedApiNames: [...AGENT_SHARE_SKILL_API_NAMES],
        restriction: 'unknown' as never,
      }),
    ).toBeUndefined();

    expect(
      resolveSkillsRestrictedManifest({
        allowedApiNames: [SkillsApiName.readReference],
        restriction: 'agentShare',
      }),
    ).toBeUndefined();

    expect(
      resolveSkillsRestrictedManifest({
        allowedApiNames: [...AGENT_SHARE_SKILL_API_NAMES, SkillsApiName.execScript],
        restriction: 'agentShare',
      }),
    ).toBeUndefined();
  });
});
