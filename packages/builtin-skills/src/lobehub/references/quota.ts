const content = `# lh quota - Subscription Quota of Agent Runtimes

Agents that run on Claude Code, Codex or Kimi Code spend the subscription account signed in on
their device, not LobeHub credits. \`lh quota\` reads those accounts' quota windows (5-hour session,
weekly, model-scoped weekly) as last reported by the devices. Use it to tell whether an agent can
take more work right now, or when its account gets quota back.

\`lh usage\` is a different thing: LobeHub's own credits and spend.

## Subcommands

- \`lh quota list [--provider <claude-code|codex|kimi-code>]\` - Every visible account with its 5h / weekly / model-weekly usage and status
- \`lh quota view <accountId>\` - One account: every window with its reset time, and the agent runs spending it now
- \`lh quota agent <agentId> [--device <deviceId>] [--provider <provider>]\` - The account the agent would run on now (\`current\`, with \`reason\` pinned / balanced) and every account bound to it
- \`lh quota refresh --device <deviceId> --provider <codex|kimi-code>\` - Sample quota on the device now and store it; Claude Code is reported by the desktop app on its own

All of them accept \`--json\`.

## Status

Each account folds its windows into one \`status\`:

- \`ok\` - every window below 80%
- \`warning\` - a window at 80% or more
- \`exhausted\` - a window is full; \`unavailableUntil\` is when the account gets quota back
- \`unknown\` - no device has reported this account yet

Utilization is the provider's own number at \`updatedAt\`. A window whose reset time has passed counts
as 0%. When \`updatedAt\` is old and the account is Codex or Kimi Code, run \`lh quota refresh\` first.

## Examples

\`\`\`bash
# Which accounts are out of quota right now
lh quota list --json accountId,provider,email,status,unavailableUntil

# Can this agent take a task now?
lh quota agent <agentId> --json
\`\`\`
`;

export default content;
