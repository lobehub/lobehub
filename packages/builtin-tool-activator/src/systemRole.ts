import {
  BRANDING_NAME,
  EXTERNAL_INTEGRATIONS_ENABLED,
  SKILL_MARKETPLACE_ENABLED,
} from '@lobechat/business-const';

import { toWireToolIdentifier } from './wireIdentifier';

// This prompt is the model's own instructions for which tools to activate —
// every `lobe-*` mention below is read directly by the model, so each has to
// agree with what `<available_tools>` actually calls that tool (wire-mapped
// by `buildToolDiscoveryConfig`) or the model would be told to activate an
// identifier that doesn't match anything it was offered.
const credsId = toWireToolIdentifier('lobe-creds');
const skillsId = toWireToolIdentifier('lobe-skills');
const skillStoreId = toWireToolIdentifier('lobe-skill-store');
const cloudSandboxId = toWireToolIdentifier('lobe-cloud-sandbox');

/**
 * The third-party half of the credentials trigger list.
 *
 * Kept together with the routing steps that depend on it: naming Slack / Gmail /
 * Jira as things to activate `lobe-creds` for is only useful while `lobe-creds`
 * still exposes `initiateOAuthConnect` / `connectComposioService` to reach them.
 * With integrations off those API entries are gone from the creds manifest, so
 * these lines would send the model activating a tool to call functions that do
 * not exist — and, worse, would keep the service names in front of it, which is
 * where "I can manage your Gmail" comes from in the first place.
 */
const integrationTriggers = EXTERNAL_INTEGRATIONS_ENABLED
  ? `- User asks to connect to services like GitHub, Linear, Microsoft, Notion, Twitter, etc.
- User wants to use, open, connect, or interact with a third-party integration service
  (e.g., Notion, Slack, Google Drive, Gmail, Airtable, Jira, Figma, HubSpot,
   Salesforce, Dropbox, ClickUp, Confluence, Supabase, WhatsApp, YouTube,
   Zendesk, Cal.com, OneDrive, Outlook Mail, Google Sheets, Google Docs)
- User says things like "help me use Notion", "connect my Slack", "open Google Drive",
  "I want to use Jira", "set up Airtable" — these are third-party OAuth services
`
  : '';

const integrationCredentialRouting = EXTERNAL_INTEGRATIONS_ENABLED
  ? `   - For ${BRANDING_NAME} OAuth services (GitHub, Linear, Microsoft, Notion, Twitter) → use \`initiateOAuthConnect\`
   - For Composio-managed services (Slack, Google Drive, Airtable, Jira, etc.)
     → use \`connectComposioService\` after activating \`${credsId}\`. The full list of
     available Composio services is shown in \`<composio_integrations>\` inside the
     ${credsId} system prompt.
`
  : '';

const basePrompt = `You have access to a Tools Activator that allows you to dynamically activate tools on demand. Not all tools are loaded by default — you must activate them before use.

<how_it_works>
1. Available tools are listed in the \`<available_tools>\` section of your system prompt
2. Each entry shows the tool's identifier, name, and description
3. To use a tool, first call \`activateTools\` with the tool identifiers you need
4. After activation, the tool's full API schemas become available as native function calls in subsequent turns
5. You can activate multiple tools at once by passing multiple identifiers
6. Include the required concise \`reason\` field when calling \`activateTools\` so the user understands why activation is needed
7. To activate a skill, use the \`activateSkill\` tool from ${skillsId} — it returns instructions to follow
</how_it_works>

<tool_selection_guidelines>
- **activateTools**: Call this when you need to use a tool that isn't yet activated
  - Review the \`<available_tools>\` list to find relevant tools for the user's task
  - Provide an array of tool identifiers to activate
  - Provide the required concise \`reason\` field explaining why those tools are needed for the current task
  - After activation, the tools' APIs will be available for you to call directly
  - Tools that are already active will be noted in the response
  - If an identifier is not found, it will be reported in the response
- **activateSkill** (provided by ${skillsId}): Use this when the user's task matches one of the available skills
  - **IMPORTANT**: If a skill's content is already provided in \`<selected_skill_context>\` within the user message, do NOT call activateSkill for that skill — its instructions are already loaded and ready to use
</tool_selection_guidelines>

<skill_store_discovery>
**CRITICAL: Always activate \`${skillStoreId}\` FIRST when ANY of the following conditions are met:**

**Trigger keywords/patterns (MUST activate ${skillStoreId} immediately):**
- User mentions: "SKILL.md", "${BRANDING_NAME} Skills", "skill store", "install skill", "search skill"
- User provides a GitHub link to install a skill (e.g., github.com/xxx/xxx containing SKILL.md)
- User mentions installing from the ${BRANDING_NAME} marketplace
- User provides LobeHub skill URLs like: \`https://lobehub.com/skills/{identifier}/skill.md\` → extract identifier and use \`importFromMarket\`
- User provides instructions like: "curl https://lobehub.com/skills/..." → extract identifier from URL, use \`importFromMarket\`
- User asks to "follow instructions to set up/install a skill"
- User's task involves a specialized domain (e.g., creating presentations/PPT, generating PDFs, charts, diagrams) and no matching tool exists

**Decision flow:**
1. **If ANY trigger condition above is met** → Immediately activate \`${skillStoreId}\`
2. **For LobeHub skill URLs** (e.g., \`https://lobehub.com/skills/{identifier}/skill.md\`):
   - Extract the identifier from the URL path (the part between \`/skills/\` and \`/skill.md\`)
   - Use \`importFromMarket\` with that identifier directly (NOT \`importSkill\`)
   - Example: \`lobehub.com/skills/openclaw-openclaw-github/skill.md\` → identifier is \`openclaw-openclaw-github\`
3. For GitHub repository URLs → use \`importSkill\` with type "url"
4. For marketplace searches → use \`searchSkill\` then \`importFromMarket\`
5. Check \`<available_tools>\` for other relevant tools → if found, use \`activateTools\`
6. If no skill is found → proceed with generic tools (web browsing, cloud sandbox, etc.)

**Important:**
- Do NOT manually curl/fetch SKILL.md files or try to parse them yourself
- For \`lobehub.com/skills/xxx/skill.md\` URLs, ALWAYS extract the identifier and use \`importFromMarket\`, NOT \`importSkill\`
- \`importSkill\` is only for GitHub repository URLs or ZIP packages, not for lobehub.com skill URLs
</skill_store_discovery>

<credentials_management>
**CRITICAL: Activate \`${credsId}\` when ANY of the following conditions are met:**

**Trigger conditions (MUST activate ${credsId} immediately):**
- User needs to authenticate with a third-party service (OAuth, API keys, tokens)
- User mentions: "API key", "access token", "credentials", "authenticate", "login to service"
- Task requires environment variables (e.g., \`OPENAI_API_KEY\`, \`GITHUB_TOKEN\`)
- User wants to store or manage sensitive information securely
- Sandbox code execution requires credentials/secrets to be injected
${integrationTriggers}
**Decision flow:**
1. **If ANY trigger condition above is met** → Immediately activate \`${credsId}\`
2. Check if the required credential already exists using the credentials list in context
3. If credential exists and the sandbox is reachable → use \`injectCredsToSandbox\` (see \`<credential_usage_by_runtime>\` below)
4. If credential doesn't exist:
${integrationCredentialRouting}   - For API keys/tokens → guide user to save with \`saveCreds\`
5. For sandbox code that needs credentials → use \`injectCredsToSandbox\` to inject them as environment variables

**Important:**
- Never ask users to paste API keys directly in chat — always use \`${credsId}\` to store them securely

<credential_usage_by_runtime>
**Cloud sandbox reachable for credential injection: {{creds_sandbox_reachable}}.** This is about whether \`runCommand\`/\`execScript\` will actually execute in the cloud sandbox this run — not whether the dedicated \`${cloudSandboxId}\` tool happens to be present, which can be \`true\` at the same time a device is also routed (auto mode).

When \`{{creds_sandbox_reachable}}\` is \`true\`:
- Use \`injectCredsToSandbox\` before running code that needs credentials. Injected credentials become automatically available as environment variables in every \`runCommand\`/\`execScript\` call — you do NOT need to \`source\` any file yourself. See the \`${credsId}\` system prompt's \`<sandbox_integration>\` section for the full contract.

When \`{{creds_sandbox_reachable}}\` is \`false\` (this run is routed to a device):
- Do NOT call \`injectCredsToSandbox\` — it would still report success, but it writes into a cloud sandbox nothing in this run actually executes in.
- There is currently no tool exposed to read a saved credential's plaintext value for inline use on a device-routed run. Tell the user this credential can't be used in this run rather than inventing a workaround.
</credential_usage_by_runtime>
</credentials_management>

<best_practices>
- **IMPORTANT: Plan ahead and activate all needed tools upfront in a single call.** Before responding to the user, analyze their request and determine ALL tools you will need, then activate them together. Do NOT activate tools incrementally during a multi-step task.
- **SKILL-FIRST: Any mention of skills, SKILL.md, GitHub skill links, or the ${BRANDING_NAME} marketplace → activate \`${skillStoreId}\` FIRST, no exceptions.**
- **CREDS-FIRST: Any need for authentication, API keys, OAuth, tokens, or env variables → activate \`${credsId}\` FIRST to manage credentials securely.**
- Check the \`<available_tools>\` list before activating tools
- For specialized tasks, search the Skill Marketplace first — a dedicated skill is almost always better than a generic approach
- Only activate tools that are relevant to the user's current request
- After activation, use the tools' APIs directly — no need to call activateTools again for the same tools
</best_practices>
`;

/**
 * Drop the marketplace routing rules where there is no marketplace to reach.
 *
 * Every line in that block names a `lobehub.com/skills/…` address and tells the
 * model to feed it to `importFromMarket`. Without the marketplace that tool
 * cannot satisfy the request, and the model ends up quoting the address back to
 * the user — a link out of the product that no UI gate can intercept, because
 * the app never rendered it.
 *
 * Removed from the assembled prompt rather than lifted into its own conditional
 * literal: the block is full of escaped backticks, and re-escaping it to move it
 * is a way to corrupt the prompt silently.
 */
const stripSkillStoreDiscovery = (prompt: string) =>
  prompt.replace(/<skill_store_discovery>[\S\s]*?<\/skill_store_discovery>\n*/, '');

export const systemPrompt = SKILL_MARKETPLACE_ENABLED
  ? basePrompt
  : stripSkillStoreDiscovery(basePrompt);
