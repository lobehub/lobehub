import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import { describe, expect, it } from 'vitest';

import {
  getVisitorVisibleEnabledToolIds,
  isToolAvailableToVisitors,
} from './toolVisitorAvailability';

describe('isToolAvailableToVisitors', () => {
  it('allows a builtin identifier on the server share allowlist', () => {
    expect(isToolAvailableToVisitors(TopicReferenceIdentifier)).toBe(true);
  });

  it('denies a builtin identifier the server share gate always rejects', () => {
    expect(isToolAvailableToVisitors(TaskIdentifier)).toBe(false);
  });

  it('allows a non-builtin identifier (MCP/market/custom plugin)', () => {
    expect(isToolAvailableToVisitors('some-mcp-server-id')).toBe(true);
  });
});

describe('getVisitorVisibleEnabledToolIds', () => {
  it('drops a denied builtin identifier so it never renders as an active grant', () => {
    expect(
      getVisitorVisibleEnabledToolIds([TopicReferenceIdentifier, TaskIdentifier, 'custom-mcp']),
    ).toEqual([TopicReferenceIdentifier, 'custom-mcp']);
  });

  it('handles a missing enabledToolIds list', () => {
    expect(getVisitorVisibleEnabledToolIds(undefined)).toEqual([]);
  });
});
