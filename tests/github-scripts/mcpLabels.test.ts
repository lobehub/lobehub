import { describe, expect, it } from 'vitest';

import {
  MCP_LABEL_DESCRIPTIONS,
  MCP_MANUAL_REVIEW_LABEL,
  MCP_RESCAN_LABEL,
  MCP_SUBMISSION_LABEL,
  MCP_TRIGGER_TRIAGE_LABEL,
} from '../../.github/scripts/shared/mcp-labels';
import { classify } from '../../.github/scripts/shared/mcp-submission-classifier';
import { shouldDedupeIssue } from '../../.github/scripts/should-run-dedupe';

describe('MCP issue labels', () => {
  it('uses normalized names and descriptions for the MCP submission workflow', () => {
    expect(MCP_SUBMISSION_LABEL).toBe('mcp:submission');
    expect(MCP_MANUAL_REVIEW_LABEL).toBe('mcp:manual-review');
    expect(MCP_RESCAN_LABEL).toBe('mcp:rescan');
    expect(MCP_TRIGGER_TRIAGE_LABEL).toBe('trigger:mcp-triage');
    expect(MCP_LABEL_DESCRIPTIONS.submission).toBe(
      'MCP marketplace listing submission handled by the MCP submission workflow',
    );
    expect(MCP_LABEL_DESCRIPTIONS.manualReview).toBe(
      'MCP submission cannot be resolved by the self-service CLI; maintainer review required',
    );
    expect(MCP_LABEL_DESCRIPTIONS.rescan).toBe(
      'Existing MCP marketplace listing needs a rescan/refresh; maintainer or automation action required',
    );
  });

  it('skips duplicate detection for MCP workflow labels', () => {
    const baseIssue = {
      body: '',
      labels: [],
      state: 'open',
      title: 'Regular issue',
    };

    for (const label of [MCP_SUBMISSION_LABEL, MCP_MANUAL_REVIEW_LABEL, MCP_RESCAN_LABEL]) {
      expect(
        shouldDedupeIssue({
          ...baseIssue,
          labels: [{ name: label }],
        }).shouldDedupe,
      ).toBe(false);
    }
  });

  it('skips duplicate detection for unlabeled rescan requests via the classifier', () => {
    const decision = shouldDedupeIssue({
      body: 'The marketplace listing is stuck on an old version, please rescan.',
      labels: [],
      state: 'open',
      title: '[Request] Rescan elecz MCP listing to v1.9.6',
    });
    expect(decision.shouldDedupe).toBe(false);
    expect(decision.reason).toContain('rescan');
  });
});

describe('classify: listing-ops (rescan of an existing listing)', () => {
  // Real historical issue titles from lobehub/lobehub.
  const rescanTitles = [
    '[MCP Marketplace] Scoring stuck for @apexfdn/copilot-mcp — manual rescan needed',
    '[Request] Re-index jcdreamjc-wudao-mcp listing stale canonical cache',
    '[Request] Rescan NodeOps-app/createos-mcp listing (updated website + docs URLs)',
    '[Request] Refresh existing petropt-petro-mcp listing — stale v0.8.1 scan, now v1.0.0',
    'Skill listing stale — mlava/scholar-sidekick-mcp not syncing from GitHub',
    'Refresh stale Hive Intelligence MCP marketplace listings',
    'Please refresh MCP server listing for repo: https://github.com/ashenud/spira-mcp',
    '[Request] Refresh metadata for cisco-open-network-sketcher (Local MCP) - version, skills, prompts, resources',
    '[Request] Refresh existing MeiGen MCP listing — stuck on v1.1.11, current is v1.3.0',
    'MCP listing stale: @brandsystem/mcp shows v0.3.0, current is v0.4.5',
    'MCP Server re-index request: degen0root-panchanga_api',
  ];

  it.each(rescanTitles)('flags "%s" as listing-ops', (title) => {
    const result = classify(title, '');
    expect(result.kind).toBe('listing-ops');
    expect(result.isSubmission).toBe(false);
  });

  it('prefers listing-ops over submission when both intents appear', () => {
    const result = classify(
      '[Request] Add scholar-sidekick-mcp to the MCP marketplace (rescan existing v0.3.0 listing to v0.4.1)',
      'https://github.com/mlava/scholar-sidekick-mcp — please rescan, npx install works.',
    );
    expect(result.kind).toBe('listing-ops');
    expect(result.isSubmission).toBe(false);
  });

  it('does not flag MCP product bugs that merely mention refreshing or lists', () => {
    const productBugTitles = [
      'Custom MCP tools not auto-refreshing & install button hangs',
      'Desktop 2.2.9: STDIO MCP tools/list succeeds, but connector.syncTools fails and no tool permissions are registered',
      '自定义添加的mcp服务器无法自动更新工具列表',
    ];
    for (const title of productBugTitles) {
      expect(classify(title, '').kind).toBe('none');
    }
  });

  it('still classifies a plain new-server submission as submission', () => {
    const result = classify(
      '[MCP Submission] Add my weather server to the marketplace',
      'Please add https://github.com/someone/weather-mcp — install with `npx weather-mcp`.',
    );
    expect(result.kind).toBe('submission');
    expect(result.isSubmission).toBe(true);
  });
});
