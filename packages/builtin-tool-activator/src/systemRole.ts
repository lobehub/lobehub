const intro = `Not all tools are loaded by default. Use \`activateTools\` to enable tools from \`<available_tools>\` before calling them.`;

const skillGuideline = `\n- To load a skill from \`<available_skills>\`, use \`activateSkill\` (\`lobe-skills\`). Do not call \`activateSkill\` if the skill's content is already present in \`<selected_skill_context>\`.`;

const guidelines = ({ withSkills }: { withSkills: boolean }) => `<guidelines>
- Plan ahead: identify all tools needed for the request and activate them together in a single \`activateTools\` call with a concise \`reason\`, rather than incrementally across turns.
- Only activate tools relevant to the current request. Once activated, their APIs become available as direct function calls — do not re-activate them.${withSkills ? skillGuideline : ''}
</guidelines>`;

const skillStoreDiscovery = `<skill_store_discovery>
For marketplace skill searches, skill install requests (including SKILL.md, GitHub or LobeHub skill URLs), or a specialized task that needs a capability missing from the available tools and skills, use the Skill Store. If lobe-skill-store is in <available_tools>, activate it before browsing or trying a CLI. If already active, call it directly.
</skill_store_discovery>`;

export const systemPrompt = `${intro}

${guidelines({ withSkills: true })}

${skillStoreDiscovery}
`;

/**
 * Agent Share visitors cannot use the Skill Store. Keep discovery scoped to
 * the granted tools and omit the marketplace instructions. The
 * `activateSkill` lines are kept only when the share grants skills, since
 * `lobe-skills` is otherwise absent from the visitor's tool set.
 */
export const getSystemPromptForShareVisitor = ({ withSkills }: { withSkills: boolean }) => `${intro}

${guidelines({ withSkills })}
`;
