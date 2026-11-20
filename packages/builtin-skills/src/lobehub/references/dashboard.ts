const content = `# lh widget / lh dashboard - Monitoring Widgets and Dashboards

A widget is a small script the platform runs in an isolated sandbox on a schedule; the one JSON
document it prints to stdout is rendered as a card. Dashboards are boards of widget cards.

When the Dashboards builtin tool is enabled in this conversation, prefer it: it previews widgets in the chat
and asks the user to approve risky dry runs and publishing. Use these commands when that tool is not available.

## Subcommands

- \`lh dashboard list [--project <projectId>]\` - List boards (with \`--project\`, every board of that project)
- \`lh dashboard view <id>\` - A board and the widgets on it
- \`lh dashboard create -t <title> [--project <projectId>] [--widget <widgetId>]\` - Create a board, optionally placing a widget (\`--project\` is required in a workspace: home boards are personal-only)
- \`lh dashboard add <dashboardId> <widgetId>\` - Place a widget on a board
- \`lh widget list [--agent <agentId>] [--project <projectId>]\` - List widgets
- \`lh widget view <id> [--script]\` - A widget with its draft / live versions and boards
- \`lh widget create -t <title> -d <metric definition> [--agent <agentId>] [--project <projectId>] [--dashboard <id>]\` - Create a widget (no script yet)
- \`lh widget edit <id> [-t <title>] [-d <metric definition>]\` - Rename or rewrite the metric definition
- \`lh widget draft <widgetId> [--script-file <path>] [--runtime <rt>] [--output-type <type>] [--manifest <json>] [--view <json>] [--note <text>]\` - Save a new draft; omitted fields keep the current draft's values
- \`lh widget dry-run <widgetId> [--version <versionId>] [--yes]\` - Run a draft once and print its REAL output, stdout/stderr and error (\`--yes\` only after the user approved a credentialed or networked version)
- \`lh widget publish <widgetId> --version <versionId> [--yes]\` - Make a dry-run-succeeded draft live
- \`lh widget run <widgetId>\` - Refresh the live version now
- \`lh widget runs <widgetId> [--run <runId>] [-L <n>]\` - Recent runs; \`--run\` for one run's full logs
- \`lh widget schedule <widgetId> <cron|off> [--timezone <tz>]\` - Set or clear the refresh cadence

## Workflow

1. \`lh widget list --agent <your agent id>\` and \`lh dashboard list\` — extend an existing widget instead of duplicating it, and pick a board.
2. \`lh widget create\` with \`--agent <your agent id>\` (and \`--project\` in a project conversation), then \`lh widget draft\` with the script.
3. \`lh widget dry-run <widgetId> --version <versionId>\` → read the output and logs → \`lh widget draft\` again → dry-run the new version … until it succeeds (or is \`partial\`, a run that still printed usable output) and the numbers look plausible. A draft with connector credentials or network hosts needs the user's approval first (see below). Do not stop at the first failure and do not ask the user to debug for you.
4. Show the user what the widget measures and the dry-run result, and **get their explicit confirmation before** \`lh widget publish <widgetId> --version <versionId> --yes\`. Publishing makes the script run unattended on a schedule; never publish on your own initiative. Only a version whose exact content produced usable output (\`succeeded\` or \`partial\`) in a dry run can be published.
5. \`lh dashboard add <dashboardId> <widgetId>\` (or \`lh dashboard create -t <title> --widget <widgetId>\`) if the user wants it on a board — prefer the project's boards for a project's widgets.

A draft that declares connector credentials (\`manifest.env\`) or network hosts (\`manifest.network.allow\`)
can act on the user's behalf — or leak a credential — the moment it runs. Before every dry run of such a
draft, show the user the exact version id, the credentials and hosts it uses and what the script does, then
**wait for their explicit approval of that exact version**, then run \`lh widget dry-run <widgetId> --version <versionId> --yes\` (the CLI refuses such a draft without it); a new draft needs a new approval. If they decline,
ask what to change instead of retrying the same draft. A draft with neither runs in a closed sandbox and
needs no approval.

## Output contract

The script must print exactly ONE JSON document to stdout — nothing else (debug output goes to stderr).
Its \`"type"\` must equal the widget's output type:

- stat:   \`{"type":"stat","value":1234,"label":"Open issues","unit":"issues","delta":-12,"trend":"down","description":"vs last week"}\`
- list:   \`{"type":"list","items":[{"title":"Fix login","url":"https://…","status":"open","time":"2026-01-02T03:04:05Z","value":3,"description":"…"}]}\`
- series: \`{"type":"series","unit":"ms","series":[{"name":"p95","points":[{"t":"2026-01-01","v":120},{"t":"2026-01-02","v":98}]}]}\`
- table:  \`{"type":"table","columns":[{"key":"repo","title":"Repo"},{"key":"stars","type":"number"}],"rows":[{"repo":"lobehub","stars":100}]}\`

Only \`type\` plus value / items / series / columns+rows are required. Column types: string | number | date | link.
Timestamps are ISO-8601 strings. When one of several sources fails, still print the document with
\`"meta":{"complete":false,"message":"GitHub API rate-limited"}\` — the card shows it as partial. Exit non-zero
only when there is nothing meaningful to show.

## Script rules

- Runtime: \`node\` (global fetch, no npm packages), \`python\` (standard library only) or \`bash\` (curl; jq may be absent). Keep scripts short, deterministic and read-only: they run unattended on every refresh and must never create, modify or delete anything in external systems.
- Network is OFF unless \`manifest.network.allow\` lists the hostnames the script calls, e.g. \`{"network":{"allow":["api.github.com"]}}\`.
- Secrets: never write a token, password or key into the script, manifest, title or description. Declare them in \`manifest.env\`, e.g. \`{"env":[{"name":"GITHUB_TOKEN","connector":"github","required":true}]}\`; the platform injects the value from the user's connected account and redacts it from logs. For a connector holding several headers, add \`"field"\` with the header to inject. If a run fails because the connector is not connected, tell the user which connector to connect — do not ask them to paste a secret into the chat.
- \`manifest.schedule\` suggests the refresh cadence applied on publish (\`{"pattern":"0 * * * *"}\`); pick the slowest cadence that keeps the number useful. \`manifest.timeoutMs\` defaults to 30000 (max 120000).
- \`manifest.metric\` (\`{"key":"open_issues","unit":"issues"}\`) records a stat's value on every published run for a long-term trend line.
- \`--view\` hints: \`{"chart":"line"|"bar"|"area"}\` for series, \`{"columns":[…]}\` for table columns, \`{"limit":10}\` to cap rows.

## Metric definition

The widget description (口径) is shown on the card and must let the user trust the number: data source,
filters, time window and unit — e.g. "Open issues labelled bug in lobehub/lobehub, excluding pull requests;
counted at run time." Update it with \`lh widget edit\` whenever the script's logic changes.

## Tips

- Dashboards are behind the \`dashboard\` feature flag; a FORBIDDEN error means it is off for this user — say so instead of retrying.
- Write the script to a file and pass \`--script-file\`; it avoids shell-quoting problems.
`;

export default content;
