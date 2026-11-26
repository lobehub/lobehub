import { ScmChangeRequestModel } from '@/database/models/scm';
import type { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';

/** A pull request a `git push` updated, as the GitHub App last reported it. */
export interface PushedPullRequest {
  headRef: string | null;
  number: number;
  repoFullName: string;
  title: string | null;
  url: string;
}

/**
 * What the shell Work scan needs to tie pull requests to a topic beyond
 * `gh pr create|edit`: a `git push` of a branch with an open PR, and numbered
 * `gh pr ready|merge` runs. A scan without it (a share visitor's run, fenced
 * off from the creator's topics) registers only what the commands name.
 */
export interface ShellPullRequestLinking {
  /** Open pull requests of `repoFullName` headed by one of `branches`. */
  findOpenPullRequestsByHead: (
    repoFullName: string,
    branches: string[],
  ) => Promise<PushedPullRequest[]>;
  /** `owner/repo#n` of every pull request already linked to the topic. */
  listTopicPullRequestIds: () => Promise<string[]>;
}

/**
 * Pull request lookups for one topic's scan. The push lookup reads
 * `scm_change_requests` — the GitHub App's webhook-fed rows — under the same
 * visibility as the SCM settings list, so a push only ever links pull
 * requests the scope can already see. Without an installation tracking the
 * repository it finds nothing, and the client's device lookup takes over.
 */
export const createShellPullRequestLinking = (params: {
  db: LobeChatDatabase;
  topicId: string;
  userId: string;
  workModel: WorkModel;
  workspaceId?: string | null;
}): ShellPullRequestLinking => {
  const scope = { userId: params.userId, workspaceId: params.workspaceId ?? null };

  return {
    findOpenPullRequestsByHead: async (repoFullName, branches) => {
      const rows = await ScmChangeRequestModel.listOpenByHeadRefs(
        params.db,
        scope,
        repoFullName,
        branches,
      );
      return rows.map((row) => ({
        headRef: row.headRef,
        number: row.number,
        repoFullName: row.repoFullName,
        title: row.title,
        url: row.url,
      }));
    },
    // Read per command, never cached for the scan: an earlier record of the same
    // run may just have linked the PR a later bare `gh pr merge <n>` names.
    listTopicPullRequestIds: async () =>
      (await params.workModel.listTopicPullRequests(params.topicId)).map((item) => item.identifier),
  };
};
