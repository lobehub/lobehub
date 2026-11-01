import { describe, expect, it } from 'vitest';

import {
  excludeDisabledComposioServices,
  generateCredsList,
  resolveAvailableComposioServices,
} from './helpers';

describe('generateCredsList', () => {
  it("tags a member-shared credential with who shared it, never as the workspace's own", () => {
    const result = generateCredsList([
      {
        key: 'github',
        name: 'GitHub Token',
        ownerDisplayName: 'Alice',
        ownerType: 'user',
        type: 'kv-env',
      },
    ]);

    expect(result).toContain('[shared by Alice]');
    expect(result).not.toContain('[workspace credential]');
  });

  it('tags a workspace-owned credential distinctly from a shared one', () => {
    const result = generateCredsList([
      { key: 'openai', name: 'OpenAI Key', ownerType: 'organization', type: 'kv-env' },
    ]);

    expect(result).toContain('[workspace credential]');
    expect(result).not.toContain('[shared by');
  });

  it('falls back to a generic label when a shared credential has no owner display name', () => {
    const result = generateCredsList([
      { key: 'github', name: 'GitHub Token', ownerType: 'user', type: 'kv-env' },
    ]);

    expect(result).toContain('[shared by a workspace member]');
  });

  it('adds no ownership tag for a personal-only list (ownerType absent)', () => {
    const result = generateCredsList([{ key: 'openai', name: 'OpenAI Key', type: 'kv-env' }]);

    expect(result).not.toContain('[shared by');
    expect(result).not.toContain('[workspace credential]');
  });
});

describe('excludeDisabledComposioServices', () => {
  it('drops a service the agent has disabled from the list', () => {
    const result = excludeDisabledComposioServices(
      [
        { identifier: 'gmail', name: 'Gmail' },
        { identifier: 'slack', name: 'Slack' },
      ],
      new Set(['gmail']),
    );

    expect(result).toEqual([{ identifier: 'slack', name: 'Slack' }]);
  });

  it('keeps every service unchanged when nothing is disabled', () => {
    const services = [{ identifier: 'gmail', name: 'Gmail' }];

    expect(excludeDisabledComposioServices(services, new Set())).toEqual(services);
  });
});

describe('resolveAvailableComposioServices', () => {
  const appTypes = [
    { identifier: 'gmail', label: 'Gmail' },
    { identifier: 'slack', label: 'Slack' },
    { identifier: 'jira', label: 'Jira' },
  ];

  it('excludes an already-connected app type from the available list', () => {
    const result = resolveAvailableComposioServices(appTypes, new Set(['gmail']), new Set());

    expect(result).toEqual([
      { identifier: 'slack', name: 'Slack' },
      { identifier: 'jira', name: 'Jira' },
    ]);
  });

  it('excludes a disabled app type even though it is not connected', () => {
    const result = resolveAvailableComposioServices(appTypes, new Set(), new Set(['slack']));

    expect(result.map((s) => s.identifier)).not.toContain('slack');
    expect(result.map((s) => s.identifier)).toEqual(['gmail', 'jira']);
  });

  it('a disabled app type never resurfaces as "available" even though it is not connected', () => {
    // Regression: mirrors the real bug (composio_integrations still listed a
    // disabled service as "available to connect" because only the connected
    // list was filtered, not the available one).
    const result = resolveAvailableComposioServices(
      appTypes,
      new Set(['gmail']),
      new Set(['slack']),
    );

    expect(result).toEqual([{ identifier: 'jira', name: 'Jira' }]);
  });
});
