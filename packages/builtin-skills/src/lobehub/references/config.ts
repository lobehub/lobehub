const content = `# lh whoami / lh usage / lh user / lh notification - Account, Usage and Settings

View account information and usage statistics. These are **top-level** commands —
there is no \`config\` module.

## Commands

- \`lh whoami [--json]\` - Display current user information and the workspace scope
- \`lh usage [--month <YYYY-MM>] [--agent-id <id>] [--daily] [--json]\` - View token usage statistics

## Account (\`lh user\`)

- \`lh user info [--json]\` - View registration info
- \`lh user update-name [--full-name <name>] [--username <name>]\` - Change the display name or username
- \`lh user update-avatar <url>\` - Change the avatar (URL or Base64)
- \`lh user settings --data <json>\` - Update user settings
- \`lh user preferences --data <json>\` - Update user preferences

These change the user's own account. Only run them when the user asks for that change.

## Notification settings (\`lh notification\`)

- \`lh notification settings [--workspace [id]] [--json]\` - Show which channels and types are on
- \`lh notification disable <channel> [--type <category.type>] [--platform <id>]\` - Turn off a channel (\`email\`, \`im\`, \`inbox\`, \`push\`), one IM platform, or specific types
- \`lh notification enable <channel> [--type <category.type>] [--platform <id>]\` - Turn them back on
- \`lh notification update --data <json>\` - Merge a raw patch, e.g. \`{"content":{"scheduledTaskSummary":false}}\`

Without \`--workspace\` these change personal settings; with it, the user's own
preferences for that workspace. Untouched switches keep their value, and unset ones
default to on. Prefer these over \`lh user settings\`, which replaces the whole
notification object.

## Import from other tools (\`lh migrate\`)

- \`lh migrate openclaw [--source <path>] [--agent-id <id> | --slug <slug>] [--dry-run] [--yes]\` - Import OpenClaw workspace files from this machine as agent documents (run \`--dry-run\` first)

## Tips

- \`whoami\` shows user ID, email, account details and whether commands run in a workspace
- \`usage --daily\` shows a daily breakdown with heatmap
`;

export default content;
