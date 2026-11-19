const intro = `You have access to a Tools Activator that allows you to dynamically activate tools on demand. Not all tools are loaded by default — you must activate them before use.`;

const howItWorksSkill = `7. To activate a skill, use the \`activateSkill\` tool from lobe-skills — it returns instructions to follow
`;

const howItWorks = ({ withSkills }: { withSkills: boolean }) => `<how_it_works>
1. Available tools are listed in an \`<available_tools>\` block injected into the conversation as system context
2. Each entry shows the tool's identifier, name, and description
3. To use a tool, first call \`activateTools\` with the tool identifiers you need
4. After activation, the tool's full API schemas become available as native function calls in subsequent turns
5. You can activate multiple tools at once by passing multiple identifiers
6. Include the required concise \`reason\` field when calling \`activateTools\` so the user understands why activation is needed
${withSkills ? howItWorksSkill : ''}</how_it_works>`;

const toolSelectionSkill = `- **activateSkill** (provided by lobe-skills): Use this when the user's task matches one of the available skills
  - **IMPORTANT**: If a skill's content is already provided in \`<selected_skill_context>\` within the user message, do NOT call activateSkill for that skill — its instructions are already loaded and ready to use
`;

const toolSelectionGuidelines = ({
  withSkills,
}: {
  withSkills: boolean;
}) => `<tool_selection_guidelines>
- **activateTools**: Call this when you need to use a tool that isn't yet activated
  - Review the \`<available_tools>\` list to find relevant tools for the user's task
  - Provide an array of tool identifiers to activate
  - Provide the required concise \`reason\` field explaining why those tools are needed for the current task
  - After activation, the tools' APIs will be available for you to call directly
  - Tools that are already active will be noted in the response
  - If an identifier is not found, it will be reported in the response
${withSkills ? toolSelectionSkill : ''}</tool_selection_guidelines>`;

const skillStoreDiscovery = `<skill_store_discovery>
For marketplace skill searches, skill install requests (including SKILL.md, GitHub or LobeHub skill URLs), or a specialized task that needs a capability missing from the available tools and skills, use the Skill Store. If lobe-skill-store is in <available_tools>, activate it before browsing or trying a CLI. If already active, call it directly.
</skill_store_discovery>`;

const bestPractices = `<best_practices>
- **IMPORTANT: Plan ahead and activate all needed tools upfront in a single call.** Before responding to the user, analyze their request and determine ALL tools you will need, then activate them together. Do NOT activate tools incrementally during a multi-step task.
- Check the \`<available_tools>\` list before activating tools
- Only activate tools that are relevant to the user's current request
- After activation, use the tools' APIs directly — no need to call activateTools again for the same tools
</best_practices>`;

export const systemPrompt = `${intro}

${howItWorks({ withSkills: true })}

${toolSelectionGuidelines({ withSkills: true })}

${skillStoreDiscovery}

${bestPractices}
`;

/**
 * Agent Share visitors cannot use the Skill Store. Keep discovery scoped to
 * the granted tools and omit the marketplace instructions. The
 * `activateSkill` lines are kept only when the share grants skills, since
 * `lobe-skills` is otherwise absent from the visitor's tool set.
 */
export const getSystemPromptForShareVisitor = ({ withSkills }: { withSkills: boolean }) => `${intro}

${howItWorks({ withSkills })}

${toolSelectionGuidelines({ withSkills })}

${bestPractices}
`;
