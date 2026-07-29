import { classify } from '../../.github/scripts/shared/mcp-submission-classifier';

describe('MCP submission classifier', () => {
  it('does not classify publishing skill feedback as a new submission', () => {
    const classification = classify(
      '[MCP Submission] Feedback about the publishing skill',
      `I am trying to publish my MCP server with the publishing skill from https://lobehub.com/publish-mcp/skill.md.

- Repo: https://github.com/example/local-mcp-server
- Install: npx local-mcp-server

The publishing skill points me at the wrong command sequence for this server.`,
    );

    expect(classification).toMatchObject({
      isSubmission: false,
      reason: 'looks like CLI/publishing feedback',
    });
  });
});
