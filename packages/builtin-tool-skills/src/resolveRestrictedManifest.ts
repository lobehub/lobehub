import type { BuiltinRestrictedManifestResolver } from '@lobechat/types';

import { SkillsManifest } from './manifest';
import { AGENT_SHARE_SKILL_API_NAMES } from './types';

/**
 * Replacement `systemRole` for the share-visitor surface.
 *
 * The full {@link SkillsManifest.systemRole} documents all five APIs including
 * a whole `runCommand` vs `execScript` decision tree. Kept as-is after the
 * strip it would teach a visitor's model to announce — and keep retrying —
 * capabilities that are not callable, so the role is rewritten rather than
 * dropped: dropping it entirely would also lose the one instruction that
 * actually matters here, that a skill already inlined into the message must not
 * be activated again.
 */
export const agentShareSystemPrompt = `You have access to a Skills tool that loads skills — reusable instruction packages that extend your capabilities.

<core_capabilities>
1. Activate a skill by name to load its instructions (activateSkill)
2. Read reference files attached to an activated skill (readReference)
</core_capabilities>

<workflow>
1. When the user's task matches an available skill, call activateSkill to load its instructions
2. Follow the skill's instructions to complete the task
3. If the skill content references additional files, use readReference to load them
</workflow>

<tool_selection_guidelines>
- **activateSkill**: Call this when the user's task matches one of the available skills
  - Provide the exact skill name
  - Returns the skill content (instructions, templates, guidelines) that you should follow
  - **IMPORTANT**: If a skill's content is already provided in \`<selected_skill_context>\` within the user message, do NOT call activateSkill for that skill — its instructions are already loaded and ready to use

- **readReference**: Call this to read reference files mentioned in a skill's content
  - Requires the id (returned by activateSkill) and the file path
  - Returns the file content for you to use as context
  - Only use paths that are referenced in the skill content
</tool_selection_guidelines>

<best_practices>
- Only activate skills when the user's task clearly matches the skill's purpose
- Follow the skill's instructions carefully once loaded
- Use readReference only for files explicitly mentioned in the skill content
- This tool cannot run commands or scripts in this conversation. If a skill's instructions call for executing a script, do as much as you can from the written instructions and tell the user which step needs execution instead of pretending it ran
</best_practices>
`;

/**
 * Owns the Agent Share projection of the Skills tool.
 *
 * Like the Documents projection, the semantic rewrite lives in the tool's own
 * package so Share orchestration never has to know which of this tool's APIs
 * the systemRole talks about. `shareToolManifest.ts` re-checks that the
 * returned manifest's API set matches the policy-approved one exactly, so this
 * resolver can never widen the surface the gate decided on.
 */
export const resolveSkillsRestrictedManifest: BuiltinRestrictedManifestResolver = ({
  allowedApiNames,
  restriction,
}) => {
  if (restriction !== 'agentShare') return undefined;

  // Only claim the surface this projection was written for. A different subset
  // (e.g. `readReference` alone, or anything exec-class) returns `undefined`,
  // and the caller falls back to the plain strip with no systemRole — the
  // fail-closed outcome, never a role describing APIs that are not offered.
  const allowed = new Set(allowedApiNames);
  const isSupportedApiSet =
    allowed.size === AGENT_SHARE_SKILL_API_NAMES.size &&
    [...allowed].every((apiName) => AGENT_SHARE_SKILL_API_NAMES.has(apiName));
  if (!isSupportedApiSet) return undefined;

  return {
    ...SkillsManifest,
    api: SkillsManifest.api.filter((api) => allowed.has(api.name)),
    systemRole: agentShareSystemPrompt,
  };
};
