import type {
  ScmChangeRequestMetadata,
  ScmChangeRequestSnapshot,
  ScmCiStatus,
  ScmReviewDecision,
  TopicPullRequestItem,
  TopicPullRequestLinkMeta,
  TopicPullRequestScmState,
  TopicPullRequestWork,
} from '@lobechat/types';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import { ScmChangeRequestModel } from '@/database/models/scm';
import type { TopicModel } from '@/database/models/topic';
import { parseGitPushResult, type WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { SCM_MAX_WAKES } from '@/server/services/scm/limits';

import {
  createShellPullRequestLinking,
  isBetterCodingExperienceEnabled,
} from './pullRequestLinking';
import { readShellCommandRecord } from './shellWorkRegistration';
import { parsePullRequestUrl } from './topicPullRequestLinks';

const log = debug('lobe-server:topic-pull-requests');

const identityKey = (repoFullName: string, number: number) =>
  `${repoFullName.toLowerCase()}#${number}`;

/** The fields of a tracked change request this listing reports. */
type ScmChangeRequestState = Pick<
  ScmChangeRequestSnapshot,
  'isDraft' | 'mergedAt' | 'number' | 'repoFullName' | 'state' | 'title'
> & {
  ciStatus?: ScmCiStatus | null;
  id: string;
  metadata?: ScmChangeRequestMetadata | null;
  reviewDecision?: ScmReviewDecision | null;
  topicId?: string | null;
  updatedAt: Date;
  wakeCount: number;
};

type OwnerTopic = TopicPullRequestScmState['autoFix']['ownerTopic'];

const toScmState = (
  row: ScmChangeRequestState,
  ownerTopic: OwnerTopic,
): TopicPullRequestScmState => ({
  autoFix: {
    changeRequestId: row.id,
    enabled: row.metadata?.autoFix !== false,
    maxWakes: SCM_MAX_WAKES,
    ownerTopic,
    ownerTopicId: row.topicId ?? null,
    wakeCount: row.wakeCount,
  },
  ciStatus: row.ciStatus ?? null,
  isDraft: row.isDraft ?? false,
  mergedAt: row.mergedAt ?? null,
  reviewDecision: row.reviewDecision ?? null,
  state: row.state,
  title: row.title ?? null,
  updatedAt: row.updatedAt,
});

const toLinkItem = (link: TopicPullRequestLinkMeta): TopicPullRequestWork | null => {
  const parsed = parsePullRequestUrl(link.url);
  if (!parsed) return null;
  return {
    ...(link.headRefName ? { headBranch: link.headRefName } : {}),
    identifier: parsed.identifier,
    linkedAt: new Date(link.linkedAt),
    number: parsed.number,
    repoFullName: parsed.repoFullName,
    source: link.source,
    status: null,
    title: link.title ?? null,
    url: parsed.url,
    workId: null,
  };
};

/**
 * Pull requests linked to a topic — its `github_pull_request` Work rows plus
 * the links kept on the topic (branch match, by hand), minus the ones removed
 * from it — latest link first, each with the GitHub App's state when an
 * installation the scope can see tracks the repository. `scm: null` means "not
 * confirmed here": the client then asks the execution device, and only
 * confirmed, vouched data may enable merge / close. A tracked PR also carries
 * its Auto-fix state and the conversation that Auto-fix wakes — named when it
 * is another conversation the viewer can open.
 */
export const listTopicPullRequestsWithStatus = async (params: {
  db: LobeChatDatabase;
  topicId: string;
  topicModel: TopicModel;
  userId: string;
  workModel: WorkModel;
  workspaceId?: string | null;
}): Promise<TopicPullRequestItem[]> => {
  const [works, topic] = await Promise.all([
    params.workModel.listTopicPullRequests(params.topicId),
    params.topicModel.findById(params.topicId),
  ]);
  const meta = topic?.metadata?.pullRequests;
  const dismissed = new Set((meta?.dismissed ?? []).map((id) => id.toLowerCase()));
  const fromWorks = new Set(works.map((item) => item.identifier.toLowerCase()));

  const items = [
    // Work rows were parsed by the server from the run's own tool messages.
    ...works.map((item) => ({ item, vouched: true })),
    ...(meta?.links ?? []).flatMap((link) => {
      const item = toLinkItem(link);
      return item && !fromWorks.has(item.identifier.toLowerCase())
        ? [{ item, vouched: link.vouched }]
        : [];
    }),
  ]
    .filter(({ item }) => !dismissed.has(item.identifier.toLowerCase()))
    .sort((a, b) => b.item.linkedAt.getTime() - a.item.linkedAt.getTime());
  if (items.length === 0) return [];

  const rows = await ScmChangeRequestModel.listByIdentities(
    params.db,
    { userId: params.userId, workspaceId: params.workspaceId ?? null },
    items.map(({ item }) => ({ number: item.number, repoFullName: item.repoFullName })),
  );
  const byIdentity = new Map(rows.map((row) => [identityKey(row.repoFullName, row.number), row]));

  // Scoped to the viewer: a conversation they cannot open stays unnamed.
  const otherTopicIds = [
    ...new Set(
      rows.flatMap((row) => (row.topicId && row.topicId !== params.topicId ? [row.topicId] : [])),
    ),
  ];
  const otherTopics = new Map(
    (await params.topicModel.findByIds(otherTopicIds)).map((topic) => [
      topic.id,
      { agentId: topic.agentId ?? null, id: topic.id, title: topic.title ?? null },
    ]),
  );

  return items.map(({ item, vouched }) => {
    const row = byIdentity.get(identityKey(item.repoFullName, item.number));
    const ownerTopic = row?.topicId ? (otherTopics.get(row.topicId) ?? null) : null;
    return { ...item, scm: row ? toScmState(row, ownerTopic) : null, vouched };
  });
};

/** One pull request the execution device found for a pushed branch (`gh pr list --head`). */
export interface DeviceReportedPullRequest {
  headRefName: string;
  /** `owner/repo` of the PR's head branch, from devices that report it. */
  headRepoFullName?: string;
  isDraft?: boolean;
  number: number;
  state?: string;
  title?: string;
  url: string;
}

export type LinkPushedPullRequestsResult =
  | { linked: string[]; status: 'linked' }
  /** The push's tool message is not persisted (or not parseable) yet — retry shortly. */
  | { status: 'pending' }
  | { status: 'skipped' };

const PULL_URL_RE = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/i;

/**
 * Link the pull requests a `git push` updated, right after the push (Better
 * Coding Experience). The server re-reads the push from the persisted tool
 * message — the client only names which call it was — and takes the
 * repository and branches from git's own report. Which pull request heads the
 * branch comes from, in order:
 *
 * 1. the GitHub App's rows, when an installation tracks the repository;
 * 2. otherwise the execution device's `gh pr list --head` answer, accepted
 *    only for that same repository and one of the pushed branches. The device
 *    belongs to the caller, so this asserts nothing they could not already
 *    register by running `gh pr edit <n>` in the conversation.
 */
export const linkPushedPullRequests = async (params: {
  db: LobeChatDatabase;
  devicePullRequests: DeviceReportedPullRequest[];
  messageModel: MessageModel;
  toolCallId: string;
  topicId: string;
  userId: string;
  workModel: WorkModel;
  workspaceId?: string | null;
}): Promise<LinkPushedPullRequestsResult> => {
  if (!(await isBetterCodingExperienceEnabled(params.db, params.userId))) {
    return { status: 'skipped' };
  }

  const messageId = await params.messageModel.findToolMessageIdByToolCallId(params.toolCallId);
  if (!messageId) return { status: 'pending' };
  const [record] = await params.messageModel.listMessagePluginsByIds({
    ids: [messageId],
    topicId: params.topicId,
  });
  if (!record) return { status: 'skipped' };

  const shell = readShellCommandRecord({
    apiName: record.apiName ?? '',
    arguments: record.arguments,
    content: record.content,
    error: record.error,
    id: record.id,
    identifier: record.identifier,
    state: record.state,
    toolCallId: record.toolCallId ?? '',
  });
  if (!shell) return { status: 'skipped' };

  const push = parseGitPushResult({ command: shell.data.command, output: shell.transcript });
  // The tool row may still be streaming in when the client fires right at
  // tool end; an empty transcript is "not yet", not "no push".
  if (!push) return shell.transcript ? { status: 'skipped' } : { status: 'pending' };

  const linking = createShellPullRequestLinking({
    db: params.db,
    topicId: params.topicId,
    userId: params.userId,
    workModel: params.workModel,
    workspaceId: params.workspaceId,
  });
  const tracked = await linking.findOpenPullRequestsByHead(push.repoFullName, push.branches);

  const branches = new Set(push.branches);
  const candidates =
    tracked.length > 0
      ? tracked.map((pr) => ({
          headRef: pr.headRef,
          isDraft: undefined as boolean | undefined,
          number: pr.number,
          repoFullName: pr.repoFullName,
          state: undefined as string | undefined,
          title: pr.title,
          url: pr.url,
        }))
      : params.devicePullRequests.flatMap((pr) => {
          const match = PULL_URL_RE.exec(pr.url);
          if (!match || Number(match[3]) !== pr.number) return [];
          const repoFullName = `${match[1]}/${match[2]}`;
          // The push went to the PR's head repository: the PR's own repository,
          // or — for a fork PR — the fork its head lives in.
          const pushed = push.repoFullName.toLowerCase();
          const headRepo = (pr.headRepoFullName ?? repoFullName).toLowerCase();
          if (headRepo !== pushed) return [];
          if (!branches.has(pr.headRefName)) return [];
          return [
            {
              headRef: pr.headRefName,
              isDraft: pr.isDraft,
              number: pr.number,
              repoFullName,
              state: pr.state,
              title: pr.title ?? null,
              url: pr.url,
            },
          ];
        });

  const linked: string[] = [];
  for (const pr of candidates) {
    const identifier = `${pr.repoFullName}#${pr.number}`;
    const status =
      pr.state === undefined
        ? undefined
        : pr.state.toLowerCase() === 'open'
          ? pr.isDraft
            ? 'draft'
            : 'open'
          : pr.state.toLowerCase();
    try {
      await params.workModel.registerExternal({
        changeType: 'updated',
        identifier,
        messageId: record.id,
        metadata: {
          ...(pr.headRef ? { headBranch: pr.headRef } : {}),
          pullRequestLink: 'push',
        },
        patchFields: [
          'identifier',
          'url',
          ...(pr.title ? (['title'] as const) : []),
          ...(status ? (['status'] as const) : []),
        ],
        resourceId: identifier,
        resourceType: 'github_pull_request',
        status: status ?? null,
        title: pr.title,
        // Its own dedupe key: the completion scan registers this same push again
        // with the run's provenance (rootOperationId / agent), which is what makes
        // it render as the run's Work card — sharing the call id would make that
        // later version a no-op and the card would never show it.
        toolCallId: `${record.toolCallId ?? params.toolCallId}#push-link`,
        toolIdentifier: record.identifier ?? 'unknown',
        toolName: record.apiName ?? 'unknown',
        topicId: params.topicId,
        url: pr.url,
      });
      linked.push(identifier);
    } catch (error) {
      log('Failed to link %s to topic %s: %O', identifier, params.topicId, error);
    }
  }

  return { linked, status: 'linked' };
};
