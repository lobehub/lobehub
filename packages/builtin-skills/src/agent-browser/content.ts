/**
 * The agent-browser release the desktop app downloads
 * (`apps/desktop/src/main/modules/binaries/agentBrowserBinaries.ts` `pinnedVersion`).
 * The `npx` fallback below runs this same version; `content.test.ts` fails if the
 * two drift apart.
 */
export const AGENT_BROWSER_PINNED_VERSION = '0.31.1';

const NPX_AGENT_BROWSER = `npx -y agent-browser@${AGENT_BROWSER_PINNED_VERSION}`;

export const systemPrompt = `<agent_browser_guides>
# agent-browser

\`agent-browser\` is a fast browser automation CLI for AI agents — drives Chrome/Chromium via CDP and serves accessibility-tree snapshots with compact \`@eN\` element refs (so you act on the page in a few hundred tokens, not raw HTML).

## Before the first command — check the CLI is available

The desktop app downloads \`agent-browser\` in the background, so it may be missing (first launch, offline, download failed) — and on other devices it may never have been installed. Check once before using it:

\`\`\`bash
command -v agent-browser   # macOS / Linux
where agent-browser        # Windows
\`\`\`

- **Found** → use \`agent-browser\` as written below.
- **Not found** (or a command fails with \`command not found\` / exit 127 / ENOENT) → if Node.js is available, run it through npx instead, and substitute this prefix for every \`agent-browser\` in the commands below (each command runs in a fresh shell, so repeat the full prefix):
  \`\`\`bash
  ${NPX_AGENT_BROWSER} open example.com
  \`\`\`
- **Neither works** (no \`npx\` either) → stop and tell the user \`agent-browser\` isn't installed on this device yet. The LobeHub desktop app retries the download on its next launch, and **Settings → System Tools → Browser Automation** shows whether it's been detected; they can also install it themselves with \`npm i -g agent-browser\` or \`brew install agent-browser\`. Don't hand-roll a replacement with curl/python scraping.

If a command fails because no browser is available, run \`agent-browser install\` (same prefix) once to download Chrome for Testing, then retry.

## The core loop

\`\`\`bash
agent-browser open example.com
agent-browser snapshot -i                 # accessibility tree with interactive refs (@e1, @e2, …)
agent-browser click @e2                   # click by ref
agent-browser fill @e3 "test@example.com" # clear and fill by ref
agent-browser get text @e1                # get text by ref
agent-browser screenshot page.png
agent-browser close
\`\`\`

Refs become **stale on every page change** (click that navigates, form submit, dynamic re-render, dialog open). Always re-snapshot before the next ref interaction.

If a page opens to an empty body or a verification/challenge screen, treat it as a block, not a slow load — go straight to the real-Chrome step below.

If a page requires signing in (a login form, an account/password wall, or an OTP/verification step you have no credentials for), don't guess credentials or engineer a way around the gate. Open it in a visible browser — the real-Chrome CDP window below is one — ask the user to sign in themselves in that window, and continue once they confirm.

When the task is done — every time, as the final step and without waiting to be asked — run \`agent-browser close\` and quit any Chrome you launched for CDP. A browser you opened for the task otherwise keeps running on the user's machine. See the teardown rule below for how to quit the CDP Chrome without touching the user's own browser.

## Blocked pages — escalate to real Chrome

Empty body, verification screen, or obfuscated JS means the page is **blocked, not loading**. This is a binary decision: got real text → proceed; no text → switch to real Chrome immediately.

1. **Verify once** — \`agent-browser open <url>\`, then \`agent-browser wait --fn "document.body.innerText.length > 100" --timeout 3000\`. If it succeeds, page is usable — continue.
2. **Timed out → launch real Chrome over CDP.** Its human fingerprint bypasses JS challenges:
   \`\`\`bash
   # macOS:
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
     --remote-debugging-port=9222 --user-data-dir="$HOME/.agent-browser-cdp" &
   # Linux (binary may be \`google-chrome-stable\`, \`chromium\` or \`chromium-browser\` — check with \`command -v\`):
   #   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.agent-browser-cdp" &
   # Windows (PowerShell):
   #   Start-Process "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe" -ArgumentList '--remote-debugging-port=9222',"--user-data-dir=$env:USERPROFILE\\.agent-browser-cdp"
   agent-browser --cdp 9222 open <url>
   agent-browser --cdp 9222 wait --fn "document.body.innerText.length > 100" --timeout 3000
   agent-browser --cdp 9222 read              # read rendered DOM as clean markdown
   # when done, close the CDP Chrome (it keeps running otherwise):
   agent-browser --cdp 9222 close
   pkill -f "user-data-dir=$HOME/.agent-browser-cdp"  # macOS / Linux: kill only the automation instance
   # Windows (PowerShell):
   #   Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*agent-browser-cdp*' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
   \`\`\`

**Once you switch, commit to real Chrome.** Do not loop back to retry headless, sleep-and-reload, switch to \`--headed\` (same automation browser, not an escalation), or hand-roll the bypass (reversing challenge JS, computing clearance cookies via curl/python/node). Real Chrome is the general answer.

**Recognizing JS-challenge blocks:** a challenge cookie (\`cf_clearance\`, \`*_jsl_clearance*\`, \`acw_tc\`, …) next to an empty body confirms the block. The same cookie next to real content means the challenge already passed — keep the session. For large page output, dump to a file first and inspect with \`grep\`/\`head\`.

**Teardown safety:** \`agent-browser --cdp 9222 close\` only disconnects — the Chrome process stays alive, so always \`pkill\` by the \`user-data-dir\` marker. Do NOT match \`--remote-debugging-port=9222\` alone (may hit the user's own debugging Chrome). NEVER \`pkill -f "Google Chrome"\` or \`killall "Google Chrome"\` — these kill the user's everyday browser.

## Discovering everything else

Run \`agent-browser --help\` for the full command list, then \`agent-browser <subcommand> --help\` for any subcommand whose flags you're unsure about. The CLI also ships specialized skills (\`agent-browser skills list\`, \`agent-browser skills get <name>\`) covering Electron apps, Slack, dogfooding, Vercel Sandbox, and AWS Bedrock AgentCore — load one only when the task falls outside ordinary web pages. Those docs are command references; the real-Chrome rule above still governs how you respond to blocked pages.
</agent_browser_guides>`;
