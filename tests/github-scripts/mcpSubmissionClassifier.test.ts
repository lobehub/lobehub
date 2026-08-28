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

  it('does not classify market-cli claim failures as listing requests', () => {
    const classification = classify(
      'market-cli cannot claim org-owned MCP server',
      'Submit works for personal repos but claim rejects org even with admin access.',
    );

    expect(classification.isSubmission).toBe(false);
  });

  it('classifies org-owned MCP submissions when no claim failure occurred', () => {
    const classification = classify(
      '[Request] Add our org-owned MCP server to the marketplace',
      'Repo: https://github.com/example/acme-mcp',
    );

    expect(classification).toMatchObject({
      isSubmission: true,
      repoUrl: 'https://github.com/example/acme-mcp',
    });
  });

  it('does not classify URL-less marketplace product reports as submissions', () => {
    const classification = classify('[Request] MCP marketplace listing page filters reset', '');

    expect(classification.isSubmission).toBe(false);
  });

  it('does not classify inability to add an MCP server as a submission', () => {
    const classification = classify('[Bug] Cannot add MCP server to marketplace', '');

    expect(classification).toMatchObject({
      isSubmission: false,
      reason: 'looks like CLI/publishing feedback',
    });
  });

  it('does not classify multiline CLI failures as rescan requests', () => {
    const classification = classify(
      'Please rescan my MCP marketplace listing',
      `I ran:

market-cli plugin claim foo
Error: permission denied

Please rescan the listing.`,
    );

    expect(classification).toMatchObject({
      isSubmission: false,
      reason: 'looks like CLI/publishing feedback',
    });
  });

  it('does not classify marketplace scoring bugs as rescan requests', () => {
    const classification = classify(
      '[Bug] MCP marketplace scoring is incorrect',
      'The score shown for my server seems wrong compared to similar servers.',
    );

    expect(classification.isSubmission).toBe(false);
  });

  it('still treats a plain rescan (no CLI failure) as a listing request', () => {
    const classification = classify(
      '[Request] Rescan elecz MCP listing to v1.9.6',
      'The marketplace listing is stuck on an old version, please rescan.',
    );

    expect(classification).toMatchObject({
      isSubmission: true,
      reason: expect.stringMatching(/rescan|refresh/i),
    });
  });
});
