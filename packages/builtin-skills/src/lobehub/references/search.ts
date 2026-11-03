const content = `# lh search / lh recall - Search Resources and History

Search local resources or the web, or recall past work inside a time window.

## Subcommands

- \`lh search -q <query> [-t <type>] [-L <limit>]\` - Search local resources
- \`lh search -q <query> -w [-e <engines>] [-c <categories>]\` - Search the web
- \`lh search view <target>\` - View search result details or crawl a URL
- \`lh recall <query> [--since <when>] [--until <when>] [-t message,topic,goal,page] [--exact] [-L <n>]\` - Matching messages, conversations, goals and pages in one window

## Search Types (local)

agent, topic, file, folder, message, page, memory, mcp, plugin, communityAgent, knowledgeBase, task, goal

## Recalling past work

Use \`lh recall\` for questions like "what did I do about X last week" (weekly reports, retros, picking up an
earlier thread). One call replaces paging through \`lh message list\` and grepping locally.

- \`--since\` / \`--until\` take an ISO time, a local day (\`2026-10-12\`), or a relative span (\`24h\`, \`7d\`, \`2w\`)
- Topics merge title matches with conversations whose messages matched, so a topic named differently still shows up
- Goals are matched by title and requirement; internal code names often live there rather than in messages
- \`--exact\` makes message matching a case-sensitive whole-term match, so an acronym like \`STAMP\` stops matching "stamp" or "STAMPED"
- System-written prompts of task, cron and eval runs are hidden; add \`--include-system\` to see them
- Follow up with \`lh topic view <id>\`, \`lh goal show <id>\` or \`lh doc view <id>\`

## Tips

- Use \`-w\` flag to perform web search instead of local search
- \`lh search view <url>\` can crawl and extract content from web pages
- Web search supports engine and category filters
`;

export default content;
