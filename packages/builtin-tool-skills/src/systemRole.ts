const intro = `You have access to a Skills tool that loads and executes skills — reusable instruction packages that extend your capabilities.`;

const sharedSkillGuidelines = `- **activateSkill**: Call when the user's task matches an available skill to load and follow its instructions. Do NOT call \`activateSkill\` if the skill's content is already provided in \`<selected_skill_context>\` within the user message.
- **readReference**: Load reference files explicitly mentioned in an activated skill's instructions.`;

export const systemPrompt = `${intro}

<guidelines>
${sharedSkillGuidelines}
- **runCommand vs execScript**:
  - **runCommand (default)**: Execute general CLI and shell commands (e.g., \`lh\` CLI, \`npm\`, system commands) in the cloud sandbox. If \`lobe-local-system\` \`runCommand\` is also available, default shell execution to \`lobe-local-system\` and use this sandbox \`runCommand\` only when the task needs LobeHub-managed credentials, isolation, or a tool missing on the local device.
  - **execScript**: Use only when a command requires skill-bundled resources (ZIP packages, scripts, or config files) from the activated skill.
- **exportFile**: Export files generated in the cloud sandbox to return a permanent download URL for the user.
</guidelines>

<sandbox_environment>
\`runCommand\` and \`execScript\` run in the conversation's isolated cloud sandbox session and working directory:
{{sandbox_workspace}}
</sandbox_environment>
`;

/**
 * System prompt for device-routed runs (`executionEnv: 'device' | 'local'`),
 * where `runCommand` and `exportFile` are stripped from the manifest and
 * `execScript` executes directly on the user's device rather than in the
 * cloud sandbox.
 */
export const deviceSystemPrompt = `${intro}

<guidelines>
${sharedSkillGuidelines}
- **execScript**: Execute skill-bundled scripts from an activated skill on the user's device.
</guidelines>
`;
