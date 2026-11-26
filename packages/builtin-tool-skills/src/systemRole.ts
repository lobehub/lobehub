const intro = `You have access to a Skills tool that loads and executes skills — reusable instruction packages that extend your capabilities.`;

export const sharedSkillGuidelines = `- **activateSkill**: Call when the user's task matches an available skill to load and follow its instructions. Do NOT call \`activateSkill\` if the skill's content is already provided in \`<selected_skill_context>\` within the user message.
- **readReference**: Load reference files explicitly mentioned in an activated skill's instructions.`;

const runCommandGuideline = `Execute general CLI and shell commands (e.g., \`lh\` CLI, \`npm\`, system commands) in the cloud sandbox. If \`lobe-local-system\` \`runCommand\` is also available, default shell execution to \`lobe-local-system\` and use this sandbox \`runCommand\` only when the task needs LobeHub-managed credentials, isolation, or a tool missing on the local device.`;

const exportFileGuideline = `- **exportFile**: Export files generated in the cloud sandbox to return a permanent download URL for the user. Sandbox paths are not reachable by the user: to show or link a sandbox file in your reply (including a Markdown image), export it and use the returned Download URL, never the sandbox path.`;

export const systemPrompt = `${intro}

<guidelines>
${sharedSkillGuidelines}
- **runCommand vs execScript**:
  - **runCommand (default)**: ${runCommandGuideline}
  - **execScript**: Use only when a command requires skill-bundled resources (ZIP packages, scripts, or config files) from the activated skill.
${exportFileGuideline}
</guidelines>

<sandbox_environment>
\`runCommand\` and \`execScript\` run in the conversation's isolated cloud sandbox session and working directory:
{{sandbox_workspace}}
</sandbox_environment>
`;

const shellSandboxEnvironment = `
<sandbox_environment>
\`runCommand\` runs in the conversation's isolated cloud sandbox session and working directory:
{{sandbox_workspace}}
</sandbox_environment>
`;

/**
 * System prompt for a run with no skill to load, where the tool keeps only its
 * sandbox shell surface (see `resolveSkillsShellManifest`). A line is included
 * only when its API is offered, so the role never names an API the manifest
 * does not carry.
 */
export const getShellSystemPrompt = ({
  exportFile,
  runCommand,
}: {
  exportFile: boolean;
  runCommand: boolean;
}) => {
  const guidelines = [
    runCommand && `- **runCommand**: ${runCommandGuideline}`,
    exportFile && exportFileGuideline,
  ]
    .filter(Boolean)
    .join('\n');
  const role = `You have access to the conversation's isolated cloud sandbox.

<guidelines>
${guidelines}
</guidelines>
`;

  return runCommand ? `${role}${shellSandboxEnvironment}` : role;
};

const EXECUTION_ENVIRONMENT_OPEN = '\n<execution_environment>\n';

/** Append the per-run execution fact that `resolveSkillsManifest` resolves. */
export const appendExecutionEnvironment = (role: string, fact: string) =>
  `${role}${EXECUTION_ENVIRONMENT_OPEN}${fact}\n</execution_environment>\n`;

/** The block {@link appendExecutionEnvironment} added to `role`, or an empty string. */
export const extractExecutionEnvironment = (role: string | undefined): string => {
  const index = role?.lastIndexOf(EXECUTION_ENVIRONMENT_OPEN) ?? -1;
  return index < 0 ? '' : role!.slice(index);
};

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
