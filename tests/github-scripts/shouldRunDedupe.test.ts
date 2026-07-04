import { shouldDedupeIssue } from '../../.github/scripts/should-run-dedupe';

describe('shouldDedupeIssue', () => {
  it('skips closed issues', () => {
    const decision = shouldDedupeIssue({
      body: 'Already handled.',
      labels: [],
      state: 'closed',
      title: 'Closed issue',
    });

    expect(decision).toEqual({
      reason: 'Issue is not open',
      shouldDedupe: false,
    });
  });

  it.each(['mcp-submission', 'mcp:remote'])('skips issues already marked with %s', (label) => {
    const decision = shouldDedupeIssue({
      body: 'Please add this MCP server to the marketplace.',
      labels: [{ name: label }],
      state: 'open',
      title: '[MCP Submission] Add my server',
    });

    expect(decision).toEqual({
      reason: 'MCP marketplace listing request is handled by the MCP submission workflow',
      shouldDedupe: false,
    });
  });

  it('skips remote MCP marketplace listing requests before Claude duplicate detection runs', () => {
    const decision = shouldDedupeIssue({
      body: `Please add **DC Hub Intelligence** to the LobeHub MCP marketplace - a remote MCP server for real-time data-center & energy intelligence.

- **Endpoint:** \`https://dchub.cloud/mcp\` (streamable-http; \`X-API-Key\` optional for the free tier)
- **Repo:** https://github.com/azmartone67/dchub-mcp-server
- **Docs:** https://dchub.cloud/integrations/mcp

{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp", "transport": "http" } } }`,
      labels: [],
      state: 'open',
      title: '[Request] Add DC Hub Intelligence to the MCP marketplace',
    });

    expect(decision).toMatchObject({
      shouldDedupe: false,
    });
    expect(decision.reason).toContain('MCP marketplace listing request');
  });

  it('skips local MCP marketplace listing requests before Claude duplicate detection runs', () => {
    const decision = shouldDedupeIssue({
      body: `Please submit this MCP server to the marketplace.

- Repo: https://github.com/example/local-mcp-server
- Install: npx local-mcp-server`,
      labels: [],
      state: 'open',
      title: '[MCP Submission] Local MCP server',
    });

    expect(decision).toMatchObject({
      shouldDedupe: false,
    });
    expect(decision.reason).toContain('MCP marketplace listing request');
  });

  it('skips new MCP submissions that mention the market CLI discovery path', () => {
    const decision = shouldDedupeIssue({
      body: `Please include Cookiy MCP in the LobeHub MCP marketplace.

- Repository: https://github.com/cookiy-ai/cookiy-skill
- Install: npx cookiy-mcp

I checked @lobehub/market-cli but could not find the public MCP publish command. If there is a preferred self-service submission path, I can reformat the request.`,
      labels: [],
      state: 'open',
      title: '[Request] Include Cookiy MCP in the LobeHub MCP marketplace',
    });

    expect(decision).toMatchObject({
      shouldDedupe: false,
    });
    expect(decision.reason).toContain('MCP marketplace listing request');
  });

  it('allows ordinary open issues to continue to Claude duplicate detection', () => {
    const decision = shouldDedupeIssue({
      body: 'The chat input loses focus after uploading a file.',
      labels: [],
      state: 'open',
      title: 'Chat input loses focus after file upload',
    });

    expect(decision).toEqual({
      reason: 'Issue is eligible for duplicate detection',
      shouldDedupe: true,
    });
  });
});
