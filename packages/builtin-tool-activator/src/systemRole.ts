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

const credentialsManagement = `<credentials_management>
**CRITICAL: Activate \`lobe-creds\` when ANY of the following conditions are met:**

**Trigger conditions (MUST activate lobe-creds immediately):**
- User needs to authenticate with a third-party service (OAuth, API keys, tokens)
- User mentions: "API key", "access token", "credentials", "authenticate", "login to service"
- Task requires environment variables (e.g., \`OPENAI_API_KEY\`, \`GITHUB_TOKEN\`)
- User wants to store or manage sensitive information securely
- Sandbox code execution requires credentials/secrets to be injected
- User asks to connect to services like GitHub, Linear, Microsoft, Notion, Twitter, etc.
- User wants to use, open, connect, or interact with a third-party integration service
  (e.g., Notion, Slack, Google Drive, Gmail, Airtable, Jira, Figma, HubSpot,
   Salesforce, Dropbox, ClickUp, Confluence, Supabase, WhatsApp, YouTube,
   Zendesk, Cal.com, OneDrive, Outlook Mail, Google Sheets, Google Docs)
- User says things like "help me use Notion", "connect my Slack", "open Google Drive",
  "I want to use Jira", "set up Airtable" — these are third-party OAuth services

**Decision flow:**
1. **If ANY trigger condition above is met** → Immediately activate \`lobe-creds\`
2. Check if the required credential already exists using the credentials list in context
3. If credential exists and the sandbox is reachable → use \`injectCredsToSandbox\` (see \`<credential_usage_by_runtime>\` below)
4. If credential doesn't exist:
   - For LobeHub OAuth services (GitHub, Linear, Microsoft, Notion, Twitter) → use \`initiateOAuthConnect\`
   - For Composio-managed services (Slack, Google Drive, Airtable, Jira, etc.)
     → use \`connectComposioService\` after activating \`lobe-creds\`. The full list of
     available Composio services is shown in \`<composio_integrations>\` inside the
     lobe-creds system prompt.
   - For API keys/tokens → use \`requestCredsInput\` so the user enters them in a secure form
5. For sandbox code that needs credentials → use \`injectCredsToSandbox\` to inject them as environment variables

**Important:**
- Never ask users to paste API keys directly in chat — always use \`lobe-creds\` to store them securely

<credential_usage_by_runtime>
**Cloud sandbox reachable for credential injection: {{creds_sandbox_reachable}}.** This is about whether \`runCommand\`/\`execScript\` will actually execute in the cloud sandbox this run — not whether the dedicated Cloud Sandbox tool happens to be present, which can be \`true\` at the same time a device is also routed (auto mode).

When \`{{creds_sandbox_reachable}}\` is \`true\`:
- Use \`injectCredsToSandbox\` before running code that needs credentials. Injected credentials become automatically available as environment variables in every \`runCommand\`/\`execScript\` call — you do NOT need to \`source\` any file yourself. See the \`lobe-creds\` system prompt's \`<sandbox_integration>\` section for the full contract.

When \`{{creds_sandbox_reachable}}\` is \`false\` (this run is routed to a device):
- Do NOT call \`injectCredsToSandbox\` — it only writes into the cloud sandbox, and nothing in this run executes there.
- There is currently no tool exposed to read a saved credential's plaintext value for inline use on a device-routed run. Tell the user this credential can't be used in this run rather than inventing a workaround.
</credential_usage_by_runtime>
</credentials_management>`;

const bestPracticesCreds = `- **CREDS-FIRST: Any need for authentication, API keys, OAuth, tokens, or env variables → activate \`lobe-creds\` FIRST to manage credentials securely.**
`;

const bestPractices = ({ withCreds }: { withCreds: boolean }) => `<best_practices>
- **IMPORTANT: Plan ahead and activate all needed tools upfront in a single call.** Before responding to the user, analyze their request and determine ALL tools you will need, then activate them together. Do NOT activate tools incrementally during a multi-step task.
${withCreds ? bestPracticesCreds : ''}- Check the \`<available_tools>\` list before activating tools
- Only activate tools that are relevant to the user's current request
- After activation, use the tools' APIs directly — no need to call activateTools again for the same tools
</best_practices>`;

export const systemPrompt = `${intro}

${howItWorks({ withSkills: true })}

${toolSelectionGuidelines({ withSkills: true })}

${skillStoreDiscovery}

${credentialsManagement}

${bestPractices({ withCreds: true })}
`;

/**
 * Variant for Agent Share visitor runs. `lobe-skill-store` and `lobe-creds`
 * are never available to a visitor, so the sections that send the model to
 * activate them first would divert requests (skills, auth, GitHub/Notion…)
 * toward an impossible prerequisite instead of the granted tools. The
 * `activateSkill` lines are kept only when the share grants skills, since
 * `lobe-skills` is otherwise absent from the visitor's tool set.
 */
export const getSystemPromptForShareVisitor = ({ withSkills }: { withSkills: boolean }) => `${intro}

${howItWorks({ withSkills })}

${toolSelectionGuidelines({ withSkills })}

${bestPractices({ withCreds: false })}
`;
