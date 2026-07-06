export const systemPrompt = `<agent_browser_guides>
# agent-browser

\`agent-browser\` is a fast browser automation CLI for AI agents — drives Chrome/Chromium via CDP and serves accessibility-tree snapshots with compact \`@eN\` element refs (so you act on the page in a few hundred tokens, not raw HTML).

LobeHub desktop bundles \`agent-browser\` natively — no install needed. \`agent-browser\` lives on the user's device: when \`lobe-local-system\` runCommand is available, run all \`agent-browser\` commands through it — never through the skills exec APIs (their cloud sandbox has no browser and no \`agent-browser\` binary). Outside LobeHub, install with \`npm i -g agent-browser\` (or \`brew install agent-browser\` / \`cargo install agent-browser\`), then run \`agent-browser install\` once to fetch the bundled Chrome.

## The core loop

\`\`\`bash
agent-browser open <url>     # 1. navigate
agent-browser snapshot -i    # 2. see interactive elements (@e1, @e2, …)
agent-browser click @e3      # 3. act on a ref
agent-browser snapshot -i    # 4. re-snapshot after any page change
\`\`\`

Refs become **stale on every page change** (click that navigates, form submit, dynamic re-render, dialog open). Always re-snapshot before the next ref interaction.

If a page opens to an empty body or a verification/challenge screen, treat it as anti-bot fingerprinting — jump to the escalation ladder below instead of waiting longer or retrying.

When the task is done, run \`agent-browser close\` and quit any Chrome you launched for CDP — browsers opened for the task otherwise stay on the user's machine.

## Dynamic pages & anti-bot escalation

When scraping dynamic or anti-bot pages, escalate from cheap to heavy and stop at the first rung that yields real content:

1. **Lightweight first**: builtin web search/crawl tools (or \`curl\`) — if the main text comes back, done.
2. **Empty body, verification page, or obfuscated JS** → the page needs a real JS run: \`agent-browser open <url>\`, \`agent-browser wait --load networkidle\`, then \`agent-browser read\` (or \`snapshot\`).
3. **Still blocked** (anti-bot that fingerprints headless Chrome) → connect to a real browser: launch Chrome with \`--remote-debugging-port=9222\` (Chrome 136+ also requires a separate \`--user-data-dir\`), then drive it with \`agent-browser --cdp 9222 <command>\` — a real browser fingerprint usually passes in one go.

Rung transitions are diagnoses, not retries — recognize "blocked" instead of re-trying the same rung:

- **Blocked looks exactly like "not loaded"**: after ONE \`wait --load networkidle\`, an empty/near-empty body (\`agent-browser eval "document.body.innerText.length"\` returns ~0) means you are fingerprinted, not slow. Extra waits, longer timeouts, or re-screenshots cannot fix a fingerprint — go straight to rung 3.
- **Other block signals**: a response that is mostly obfuscated challenge JS, or a JS-challenge cookie (\`cf_clearance\`, \`*_jsl_clearance*\`, \`acw_tc\`, …) alongside an empty or challenge-page body. A clearance cookie next to real content means the challenge already passed — keep the session and read the page.
- **\`--headed\` is NOT an escalation rung**: it only opens a window on the same automation-launched browser, so the fingerprint is unchanged. The real escalation is attaching to the user's own Chrome via \`--cdp\`.
- When a rung fails, come back to this ladder — don't improvise ad-hoc diagnostics (curl retry loops, one-off python scripts, killing processes).

Discipline: the crux of anti-bot checks is "did a real browser execute the JS", so the closer to a human environment, the easier it passes. Always verify you actually got content with \`agent-browser eval "document.body.innerText.length"\` before declaring success. Dump large output to a file first, then \`grep\`/\`head\` it.

## Discovering everything else

Run \`agent-browser --help\` for the full command list, then \`agent-browser <subcommand> --help\` for any subcommand whose flags you're unsure about. The CLI also ships specialized skills (\`agent-browser skills list\`, \`agent-browser skills get <name>\`) covering Electron apps, Slack, dogfooding, Vercel Sandbox, and AWS Bedrock AgentCore — load one only when the task falls outside ordinary web pages. Those docs are command references; the anti-bot escalation ladder above still governs how you respond to blocked pages.
</agent_browser_guides>`;
