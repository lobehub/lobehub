import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { BrowserIdentifier } from '@lobechat/builtin-tool-browser';
import { KnowledgeBaseIdentifier } from '@lobechat/builtin-tool-knowledge-base';
import { MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { describe, expect, it } from 'vitest';

import {
  getShareToolCandidateIds,
  getVisitorVisibleEnabledToolIds,
  isToolAvailableToVisitors,
  runtimeManagedShareCandidateToolIds,
} from './toolVisitorAvailability';

describe('isToolAvailableToVisitors', () => {
  it('allows a builtin identifier on the server share allowlist', () => {
    expect(isToolAvailableToVisitors(TopicReferenceIdentifier)).toBe(true);
  });

  it('denies a builtin identifier the server share gate always rejects', () => {
    expect(isToolAvailableToVisitors(TaskIdentifier)).toBe(false);
  });

  it('denies lobe-page-agent — not unsafe, but every share-visitor run supplies only a main-topic appContext, so AiAgentService.execAgent always strips it outside scope: "page" (LOBE-11930 codex P2)', () => {
    expect(isToolAvailableToVisitors(PageAgentIdentifier)).toBe(false);
  });

  it('denies lobe-user-interaction — its only entry point (askUserQuestion) is humanIntervention: "always", and every share run is forced onto approvalMode: "reject" with no approver ever present, so the grant could never be exercised (LOBE-11930 P2 re-audit)', () => {
    expect(isToolAvailableToVisitors(UserInteractionIdentifier)).toBe(false);
  });

  it('denies lobe-activator — its only API (activateTools) is humanIntervention: "required", which forced reject also blocks unconditionally (LOBE-11930 P2 re-audit)', () => {
    expect(isToolAvailableToVisitors(LobeActivatorIdentifier)).toBe(false);
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

  it('drops a pinned lobe-page-agent grant — a pre-existing share config could still have it persisted from before this identifier was denied', () => {
    expect(
      getVisitorVisibleEnabledToolIds([TopicReferenceIdentifier, PageAgentIdentifier]),
    ).toEqual([TopicReferenceIdentifier]);
  });

  it('drops a persisted lobe-user-interaction grant — a share created via a template that pinned it (e.g. the Inbox agent) before this round removed it must not render as an active grant', () => {
    expect(
      getVisitorVisibleEnabledToolIds([TopicReferenceIdentifier, UserInteractionIdentifier]),
    ).toEqual([TopicReferenceIdentifier]);
  });

  it('handles a missing enabledToolIds list', () => {
    expect(getVisitorVisibleEnabledToolIds(undefined)).toEqual([]);
  });
});

describe('runtimeManagedShareCandidateToolIds', () => {
  it('includes runtime-managed tools the server share allowlist permits', () => {
    // These are enabled by AgentToolsEngine's agentModeRules independently of
    // agentConfig.plugins (hasEnabledKnowledgeBases / globalMemoryEnabled /
    // isSearchEnabled), so they must be candidates even when absent from plugins.
    expect(runtimeManagedShareCandidateToolIds).toEqual(
      expect.arrayContaining([KnowledgeBaseIdentifier, MemoryIdentifier]),
    );
  });

  it('excludes runtime-managed tools the server share gate always rejects', () => {
    // Device/local-runtime tools are runtime-managed too, but a share
    // visitor's run can never reach them (not on
    // AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS) — they must stay out of the
    // candidate set entirely rather than show as a permanently disabled row.
    expect(runtimeManagedShareCandidateToolIds).not.toContain(BrowserIdentifier);
  });
});

describe('getShareToolCandidateIds', () => {
  it('merges the agent plugin ids with the runtime-managed share candidates', () => {
    const result = getShareToolCandidateIds(['custom-mcp']);

    expect(result).toContain('custom-mcp');
    expect(result).toContain(MemoryIdentifier);
    expect(result).toContain(KnowledgeBaseIdentifier);
    expect(result).toContain(WebBrowsingManifest.identifier);
  });

  it('deduplicates an id present in both the plugin list and the runtime-managed set', () => {
    const result = getShareToolCandidateIds([MemoryIdentifier]);

    expect(result.filter((id) => id === MemoryIdentifier)).toHaveLength(1);
  });
});
