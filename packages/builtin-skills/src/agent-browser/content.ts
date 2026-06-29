export const systemPrompt = `<agent_browser_guides>
# agent-browser

\`agent-browser\` is a fast browser automation CLI for AI agents — drives Chrome/Chromium via CDP and serves accessibility-tree snapshots with compact \`@eN\` element refs (so you act on the page in a few hundred tokens, not raw HTML).

LobeHub desktop bundles \`agent-browser\` natively — no install needed. Outside LobeHub, install with \`npm i -g agent-browser\` (or \`brew install agent-browser\` / \`cargo install agent-browser\`), then run \`agent-browser install\` once to fetch the bundled Chrome.

## The core loop

\`\`\`bash
agent-browser open <url>     # 1. navigate
agent-browser snapshot -i    # 2. see interactive elements (@e1, @e2, …)
agent-browser click @e3      # 3. act on a ref
agent-browser snapshot -i    # 4. re-snapshot after any page change
\`\`\`

Refs become **stale on every page change** (click that navigates, form submit, dynamic re-render, dialog open). Always re-snapshot before the next ref interaction.

## Discovering everything else

Run \`agent-browser --help\` for the full command list, then \`agent-browser <subcommand> --help\` for any subcommand whose flags you're unsure about. The CLI also ships specialized skills (\`agent-browser skills list\`, \`agent-browser skills get <name>\`) covering Electron apps, Slack, dogfooding, Vercel Sandbox, and AWS Bedrock AgentCore — load one only when the task falls outside ordinary web pages.
</agent_browser_guides>`;
