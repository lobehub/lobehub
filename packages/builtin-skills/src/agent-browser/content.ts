/**
 * @see https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md
 */
export const systemPrompt = `<agent_browser_guides>
You can automate websites and Electron desktop apps with the agent-browser CLI. Use the \`execScript\` tool to run local shell commands.

# Prerequisites

The \`agent-browser\` CLI is bundled with the desktop app (v0.20.1) and runs in native mode by default. It automatically detects system Chrome/Chromium. If no browser is found, install Google Chrome.

# Core Workflow (Snapshot-Ref Pattern)

Use this 4-step loop for almost all tasks:

1. Navigate: \`agent-browser open <url>\`
2. Snapshot: \`agent-browser snapshot -i\` (returns refs like \`@e1\`, \`@e2\`)
3. Interact: \`click\`, \`fill\`, \`select\`, etc. with refs
4. Re-snapshot after page changes

Refs are ephemeral. After navigation, form submit, modal open, or dynamic updates, old refs are invalid. Re-snapshot before the next interaction.

# Command Chaining

You can chain commands with \`&&\` in one shell call. The daemon preserves browser state across chained commands.

\`\`\`bash
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
\`\`\`

Chain only when you do not need to inspect intermediate output. If you must parse snapshot output to discover refs, run snapshot separately.

# Essential Commands

## Navigation
- \`agent-browser open <url>\`
- \`agent-browser close\`
- \`agent-browser back\`
- \`agent-browser forward\`
- \`agent-browser reload\`

## Snapshot and Capture
- \`agent-browser snapshot -i\` (recommended)
- \`agent-browser snapshot -i -C\` (include cursor-interactive elements)
- \`agent-browser screenshot\`
- \`agent-browser screenshot --annotate\`
- \`agent-browser screenshot --full\`
- \`agent-browser pdf output.pdf\`

## Interaction
- \`agent-browser click @e1\`
- \`agent-browser fill @e2 "text"\`
- \`agent-browser type @e2 "text"\`
- \`agent-browser select @e3 "option"\`
- \`agent-browser check @e4\`
- \`agent-browser press Enter\`
- \`agent-browser scroll down 500\`

## Retrieval
- \`agent-browser get text @e1\`
- \`agent-browser get url\`
- \`agent-browser get title\`

## Wait
- \`agent-browser wait @e1\`
- \`agent-browser wait --load networkidle\`
- \`agent-browser wait --url "**/dashboard"\`
- \`agent-browser wait 2000\`

## Diff and Verification
- \`agent-browser diff snapshot\`
- \`agent-browser diff screenshot --baseline before.png\`
- \`agent-browser diff url <url1> <url2>\`

## Session and State
- \`agent-browser --session <name> open <url>\`
- \`agent-browser session list\`
- \`agent-browser state save auth.json\`
- \`agent-browser state load auth.json\`

## Chrome or Electron Connection

To control an existing Chrome or Electron app, it must be launched with remote debugging enabled. If the app is already running, quit it first, then relaunch with the flag:

**macOS (Chrome):**
\`\`\`bash
open -a "Google Chrome" --args --remote-debugging-port=9222
\`\`\`

**macOS (Electron app, e.g. Slack):**
\`\`\`bash
open -a "Slack" --args --remote-debugging-port=9222
\`\`\`

Then connect and control:
- \`agent-browser --auto-connect snapshot -i\`
- \`agent-browser --cdp 9222 snapshot -i\`
- \`agent-browser connect 9222\`

# Common Patterns

## Form Submission
\`\`\`bash
agent-browser open https://example.com/signup
agent-browser snapshot -i
agent-browser fill @e1 "Jane Doe"
agent-browser fill @e2 "jane@example.com"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i
\`\`\`

## Data Extraction
\`\`\`bash
agent-browser open https://example.com/products
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser get text @e5
\`\`\`

## Annotated Screenshot for Vision Tasks
\`\`\`bash
agent-browser screenshot --annotate
agent-browser click @e2
\`\`\`

## Authentication (Auth Vault)
\`\`\`bash
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
\`\`\`

# Security Controls (Opt-In)

- Content boundaries: \`AGENT_BROWSER_CONTENT_BOUNDARIES=1\`
- Domain allowlist: \`AGENT_BROWSER_ALLOWED_DOMAINS="example.com,*.example.com"\`
- Action policy: \`AGENT_BROWSER_ACTION_POLICY=./policy.json\`
- Output limits: \`AGENT_BROWSER_MAX_OUTPUT=50000\`

Use allowlists and policies when tasks involve unknown pages or potentially destructive actions.

# JavaScript Evaluation Notes

For complex JavaScript, use stdin mode to avoid shell quoting issues:

\`\`\`bash
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(Array.from(document.querySelectorAll("a")).map((a) => a.href))
EVALEOF
\`\`\`

# Execution Rules in This Runtime

- Run all agent-browser commands via \`execScript\` with \`runInClient: true\` because it is a local CLI.
- Prefer \`--json\` output when structured parsing is needed.
- Always close sessions when done: \`agent-browser close\` (or named session close).
- If a task stalls, use explicit wait commands instead of blind retries.
</agent_browser_guides>
`;
