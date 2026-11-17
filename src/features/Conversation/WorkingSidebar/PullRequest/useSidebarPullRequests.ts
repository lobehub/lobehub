import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { useCallback, useMemo, useState } from 'react';

import type { TopicPullRequestView } from '@/features/TopicPullRequests/pullRequestView';
import { useTopicPullRequests } from '@/features/TopicPullRequests/useTopicPullRequests';
import { workService } from '@/services/work';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { type PullRequestSnapshot, useLinkedPullRequest } from './useLinkedPullRequest';

export const toLinkedPullRequest = (view: TopicPullRequestView): DeviceGitLinkedPullRequest => ({
  ...(view.ciStatus ? { ciStatus: view.ciStatus } : {}),
  isDraft: view.isDraft,
  mergedAt: view.mergedAt ?? null,
  number: view.number,
  state: view.state,
  title: view.title,
  url: view.url,
});

/**
 * The pull request(s) the Working Sidebar shows. Without Better Coding
 * Experience: the PR linked to the working directory's branch, exactly as
 * before. With it: every PR the topic's Work rows link (Overview lists them
 * all), and the PR tab shows the one picked there — only among PRs the device
 * read in the working directory's own repository, since the pane reads that
 * number in that directory. Mutations stay locked until the GitHub App or this
 * session's device read confirmed the PR.
 */
export const useSidebarPullRequests = (params: {
  available: boolean;
  deviceId?: string;
  gitPath?: string;
  isGithub: boolean;
  snapshot?: PullRequestSnapshot;
  topicId?: string | null;
  workingDirectory?: string;
}) => {
  const betterCoding = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  // The branch → PR guess is not even asked under the lab.
  const legacy = useLinkedPullRequest(
    betterCoding ? { ...params, gitPath: undefined, isGithub: false, snapshot: undefined } : params,
  );
  const linked = useTopicPullRequests({
    deviceId: params.deviceId,
    path: params.available ? params.workingDirectory : undefined,
    topicId: params.topicId,
  });
  const [picked, setPicked] = useState<string>();

  const openable = useMemo(() => linked.views.filter((view) => view.localDetail), [linked.views]);
  const selected =
    openable.find((view) => view.identifier === picked) ??
    (linked.primary?.localDetail ? linked.primary : openable[0]);

  const refresh = useCallback(
    () => workService.refreshTopicPullRequests(params.topicId),
    [params.topicId],
  );

  const topicId = params.topicId;
  const dismissPullRequest = useCallback(
    async (view: TopicPullRequestView) => {
      if (!topicId) return;
      const { updated } = await workService.setTopicPullRequestDismissed({
        dismissed: true,
        identifier: view.identifier,
        topicId,
      });
      // Not saved (lost write race, topic not reachable): the caller reports it.
      if (!updated) throw new Error(`Could not remove ${view.identifier}`);
      await refresh();
    },
    [refresh, topicId],
  );
  /** Link a PR by URL; resolves to its `owner/repo#n`, or throws on a bad URL. */
  const linkPullRequest = useCallback(
    async (url: string) => {
      if (!topicId) return undefined;
      const { identifier, linked } = await workService.linkTopicPullRequest({
        source: 'manual',
        topicId,
        url,
      });
      // Not saved: reject so the dialog stays open with its error.
      if (!linked) throw new Error(`Could not link ${identifier}`);
      await refresh();
      return identifier;
    },
    [refresh, topicId],
  );

  if (!linked.enabled) {
    return {
      ...legacy,
      dismissPullRequest: undefined,
      linkPullRequest: undefined,
      pickPullRequest: undefined,
      probes: [],
      pullRequests: undefined,
    };
  }

  return {
    confirmError: undefined,
    // Mutations need a confirmed read AND a PR the app can vouch for.
    confirmed: !!selected?.confirmed && !!selected?.vouched,
    // A new conversation has no topic to keep a link on until its first send.
    dismissPullRequest: topicId ? dismissPullRequest : undefined,
    linkPullRequest: topicId ? linkPullRequest : undefined,
    onRetryConfirm: () => void refresh(),
    /** Open a listed PR: in the PR tab when the pane can read it, else on GitHub. */
    pickPullRequest: (view: TopicPullRequestView) => {
      setPicked(view.identifier);
      return view.localDetail;
    },
    probes: linked.probes,
    pullRequest: selected ? toLinkedPullRequest(selected) : undefined,
    pullRequests: linked.views,
    refresh,
  };
};
