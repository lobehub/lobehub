// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works } from '../../../schemas';
import { WorkModel } from '..';
import {
  cleanupWorkTestData,
  expectExternalSummaryItem,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · github', () => {
  it('registers GitHub issue creates and appends versions for edits', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const first = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { owner: 'lobehub', repo: 'lobehub', title: 'GitHub Work issue' },
      data: {
        assignees: [{ login: 'arvinxx' }],
        body: 'Track GitHub issue as Work',
        html_url: 'https://github.com/lobehub/lobehub/issues/123',
        id: 3_001,
        labels: [{ name: 'enhancement' }],
        node_id: 'I_kwDOJj1234',
        number: 123,
        state: 'open',
        title: 'GitHub Work issue',
        updated_at: '2026-07-02T08:00:00Z',
        user: { login: 'yutengjing' },
      },
      rootOperationId: 'op-github-issue-create',
      toolCallId: 'tool-call-github-issue-create',
      toolName: 'create_issue',
      topicId,
    });
    // Work keeps the current card projection and latest producer identity.
    expect(first).toMatchObject({
      description: 'Track GitHub issue as Work',
      toolIdentifier: 'github',
      title: 'GitHub Work issue',
    });

    const second = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { issue_number: 123, owner: 'lobehub', repo: 'lobehub', state: 'closed' },
      data: {
        html_url: 'https://github.com/lobehub/lobehub/issues/123',
        node_id: 'I_kwDOJj1234',
        number: 123,
        state: 'closed',
        state_reason: 'completed',
        updated_at: '2026-07-02T09:30:00Z',
      },
      rootOperationId: 'op-github-issue-edit',
      toolCallId: 'tool-call-github-issue-edit',
      toolName: 'update_issue',
      topicId,
    });
    const replay = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { issue_number: 123, owner: 'lobehub', repo: 'lobehub', state: 'closed' },
      data: {
        node_id: 'I_kwDOJj1234',
        number: 123,
        state: 'closed',
      },
      rootOperationId: 'op-github-issue-edit',
      toolCallId: 'tool-call-github-issue-edit',
      toolName: 'update_issue',
      topicId,
    });

    expect(second?.id).toBe(first?.id);
    expect(replay?.id).toBe(first?.id);
    // `owner/repo#number` is the canonical identity across API and gh surfaces.
    expect(second).toMatchObject({
      description: 'Track GitHub issue as Work',
      resourceId: 'lobehub/lobehub#123',
      resourceType: 'github_issue',
      title: 'GitHub Work issue',
      type: 'external',
    });

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      changeType: 'updated',
      content: 'Track GitHub issue as Work',
      description: 'Track GitHub issue as Work',
      identifier: 'lobehub/lobehub#123',
      status: 'closed',
      title: 'GitHub Work issue',
      url: 'https://github.com/lobehub/lobehub/issues/123',
    });
    expect(versions[1]).toMatchObject({ status: 'open', title: 'GitHub Work issue' });

    const byOperation = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-github-issue-create', 'op-github-issue-edit'],
    });
    expect(byOperation['op-github-issue-create']).toEqual([]);
    const issueSummary = expectExternalSummaryItem(byOperation['op-github-issue-edit']?.[0]);
    expect(issueSummary).toMatchObject({
      identifier: 'lobehub/lobehub#123',
      status: 'closed',
    });

    const byConversation = await workModel.listByConversation({ topicId });
    expect(byConversation).toHaveLength(1);
    expect(byConversation[0]).toMatchObject({
      identifier: 'lobehub/lobehub#123',
      resourceType: 'github_issue',
      type: 'external',
    });

    // Read-only queries and failed results never register Works.
    await workModel.handleSkillToolResult({
      provider: 'github',
      data: { node_id: 'I_kwDOJjRead', number: 200, title: 'Read only' },
      toolCallId: 'tool-call-github-read',
      toolName: 'get_issue',
      topicId,
    });
    await workModel.handleSkillToolResult({
      provider: 'github',
      data: { error: 'Validation failed', isError: true },
      toolCallId: 'tool-call-github-error',
      toolName: 'create_issue',
      topicId,
    });

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceType, 'github_issue'));
    expect(workRows).toHaveLength(1);
  });

  it('registers GitHub pull requests and dedupes updates by owner/repo#number', async () => {
    const workModel = new WorkModel(serverDB, userId);

    const pullRequest = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { base: 'canary', head: 'feat/work-registry', owner: 'lobehub', repo: 'lobehub' },
      data: JSON.stringify({
        base: { ref: 'canary', repo: { full_name: 'lobehub/lobehub' } },
        body: 'Adds the Work registry',
        draft: false,
        head: { ref: 'feat/work-registry' },
        html_url: 'https://github.com/lobehub/lobehub/pull/456',
        id: 9_001,
        merged: false,
        node_id: 'PR_kwDOJj5678',
        number: 456,
        state: 'open',
        title: 'feat: add work registry',
        user: { login: 'yutengjing' },
      }),
      rootOperationId: 'op-github-pr-create',
      toolCallId: 'tool-call-github-pr-create',
      toolName: 'create_pull_request',
      topicId,
    });

    expect(pullRequest).toMatchObject({
      resourceId: 'lobehub/lobehub#456',
      resourceType: 'github_pull_request',
      type: 'external',
    });

    // Merge-style responses carry no node_id; the target still resolves to
    // the same `owner/repo#number` identity and lands on the existing Work.
    const merged = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { owner: 'lobehub', pull_number: 456, repo: 'lobehub' },
      data: {
        merged: true,
        message: 'Pull Request successfully merged',
        sha: 'abc123def456',
      },
      rootOperationId: 'op-github-pr-merge',
      toolCallId: 'tool-call-github-pr-merge',
      toolName: 'update_pull_request',
      topicId,
    });

    expect(merged?.id).toBe(pullRequest?.id);

    const versions = await workModel.listVersions(pullRequest!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    // The status-only merge response inherits the complete create snapshot.
    expect(versions[0]).toMatchObject({
      content: 'Adds the Work registry',
      description: 'Adds the Work registry',
      identifier: 'lobehub/lobehub#456',
      status: 'merged',
      title: 'feat: add work registry',
      url: 'https://github.com/lobehub/lobehub/pull/456',
    });

    // An update addressing an entity not registered before still creates its
    // own Work row keyed by identity (consistent with the Linear adaptation).
    const unknownTarget = await workModel.handleSkillToolResult({
      provider: 'github',
      args: { owner: 'lobehub', pull_number: 999, repo: 'lobehub' },
      data: { merged: true, sha: 'fff000' },
      toolCallId: 'tool-call-github-pr-unknown',
      toolName: 'update_pull_request',
      topicId,
    });
    expect(unknownTarget?.resourceId).toBe('lobehub/lobehub#999');
    expect(unknownTarget?.id).not.toBe(pullRequest?.id);

    // A result with no resolvable `owner/repo#number` identity is skipped.
    const unresolvable = await workModel.handleSkillToolResult({
      provider: 'github',
      args: {},
      data: { merged: true },
      toolCallId: 'tool-call-github-pr-unresolvable',
      toolName: 'update_pull_request',
      topicId,
    });
    expect(unresolvable).toBeNull();

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceType, 'github_pull_request'));
    expect(workRows).toHaveLength(2);
  });

  it('registers GitHub works from sandbox gh CLI runCommand results', async () => {
    const workModel = new WorkModel(serverDB, userId);

    // The dominant github skill surface: `gh` executed in the cloud sandbox,
    // where the result is only {command, exitCode, output}.
    const created = await workModel.handleSkillToolResult({
      provider: 'github',
      args: {
        command:
          'issue create -R lobehub-biz/lobehub-cloud --title "CLI Issue" --body "created from sandbox"',
        description: 'Create a test issue',
      },
      data: {
        command:
          'gh issue create -R lobehub-biz/lobehub-cloud --title "CLI Issue" --body "created from sandbox"',
        exitCode: 0,
        output: 'https://github.com/lobehub-biz/lobehub-cloud/issues/952\n',
      },
      rootOperationId: 'op-github-cli-create',
      toolCallId: 'tool-call-github-cli-create',
      toolName: 'runCommand',
      topicId,
    });

    expect(created).toMatchObject({
      description: 'created from sandbox',
      resourceId: 'lobehub-biz/lobehub-cloud#952',
      resourceType: 'github_issue',
      title: 'CLI Issue',
      type: 'external',
    });

    // Chained commands: the trailing stdout URL identifies the edited entity.
    const edited = await workModel.handleSkillToolResult({
      provider: 'github',
      data: {
        command:
          'git status && gh issue edit 952 -R lobehub-biz/lobehub-cloud --body "updated body"',
        exitCode: 0,
        output: 'On branch main\nhttps://github.com/lobehub-biz/lobehub-cloud/issues/952\n',
      },
      rootOperationId: 'op-github-cli-edit',
      toolCallId: 'tool-call-github-cli-edit',
      toolName: 'runCommand',
      topicId,
    });
    expect(edited?.id).toBe(created?.id);

    const versions = await workModel.listVersions(created!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    // Patch merge keeps the create-time title/status while applying the new body.
    expect(versions[0]).toMatchObject({
      changeType: 'updated',
      content: 'updated body',
      description: 'updated body',
      identifier: 'lobehub-biz/lobehub-cloud#952',
      status: 'open',
      title: 'CLI Issue',
      url: 'https://github.com/lobehub-biz/lobehub-cloud/issues/952',
    });

    const pullRequest = await workModel.handleSkillToolResult({
      provider: 'github',
      data: {
        command:
          'gh pr create -R lobehub-biz/lobehub-cloud --title "CLI PR" --body "pr body" --base main --head feat/cli --draft',
        exitCode: 0,
        output: 'https://github.com/lobehub-biz/lobehub-cloud/pull/953\n',
      },
      toolCallId: 'tool-call-github-cli-pr',
      toolName: 'runCommand',
      topicId,
    });
    expect(pullRequest).toMatchObject({
      description: 'pr body',
      resourceId: 'lobehub-biz/lobehub-cloud#953',
      resourceType: 'github_pull_request',
      title: 'CLI PR',
    });
    const [pullRequestVersion] = await workModel.listVersions(pullRequest!.id);
    expect(pullRequestVersion).toMatchObject({
      content: 'pr body',
      status: 'draft',
      title: 'CLI PR',
    });

    // Failed commands, read-only subcommands, and non-gh commands are skipped.
    const failed = await workModel.handleSkillToolResult({
      provider: 'github',
      data: {
        command: 'gh issue create -R lobehub-biz/lobehub-cloud --title X',
        exitCode: 1,
        output: 'GraphQL: Resource not accessible',
      },
      toolCallId: 'tool-call-github-cli-failed',
      toolName: 'runCommand',
      topicId,
    });
    const readOnly = await workModel.handleSkillToolResult({
      provider: 'github',
      data: {
        command: 'gh issue view 952 -R lobehub-biz/lobehub-cloud',
        exitCode: 0,
        output: 'CLI Issue #952\nhttps://github.com/lobehub-biz/lobehub-cloud/issues/952',
      },
      toolCallId: 'tool-call-github-cli-view',
      toolName: 'runCommand',
      topicId,
    });
    const nonGh = await workModel.handleSkillToolResult({
      provider: 'github',
      data: { command: 'git push origin main', exitCode: 0, output: 'Everything up-to-date' },
      toolCallId: 'tool-call-github-cli-git',
      toolName: 'runCommand',
      topicId,
    });
    expect(failed).toBeNull();
    expect(readOnly).toBeNull();
    expect(nonGh).toBeNull();

    const workRows = await serverDB.select().from(works).where(eq(works.type, 'external'));
    expect(workRows).toHaveLength(2);
  });
});
