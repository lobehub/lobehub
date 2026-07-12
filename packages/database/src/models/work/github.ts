import type {
  GithubWorkPatchField,
  GithubWorkVersionSnapshot,
  RegisterGithubWorkParams,
} from '@lobechat/types';

import { slimGithubSnapshotForSummary } from './internal';
import { createSnapshotWorkAdapter, createSnapshotWorkRegister } from './snapshotWork';

export const githubSnapshot = (
  params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
  previous?: GithubWorkVersionSnapshot | null,
): { github: GithubWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  // GitHub update responses can be partial (e.g. merge results); keep prior fields.
  const pick = <T>(field: GithubWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    github: {
      assignees: pick('assignees', params.assignees, []),
      author: pick('author', params.author, null),
      baseRef: pick('baseRef', params.baseRef, null),
      body: pick('body', params.body, null),
      closedAt: pick('closedAt', params.closedAt, null),
      createdAt: pick('createdAt', params.createdAt, null),
      draft: pick('draft', params.draft, null),
      headRef: pick('headRef', params.headRef, null),
      id: params.resourceId,
      labels: pick('labels', params.labels, []),
      merged: pick('merged', params.merged, null),
      mergedAt: pick('mergedAt', params.mergedAt, null),
      number: pick('number', params.number, null),
      repo: pick('repo', params.repo, null),
      state: pick('state', params.state, null),
      stateReason: pick('stateReason', params.stateReason, null),
      title: pick('title', params.title, null),
      updatedAt: pick('updatedAt', params.updatedAt, null),
      url: pick('url', params.url, null),
    } satisfies GithubWorkVersionSnapshot,
  };
};

export const registerGithubWork = createSnapshotWorkRegister<
  Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
  GithubWorkVersionSnapshot
>({
  buildSnapshot: githubSnapshot,
  type: 'github',
});

export const githubWorkAdapter = createSnapshotWorkAdapter<GithubWorkVersionSnapshot>({
  slimForSummary: slimGithubSnapshotForSummary,
  type: 'github',
});
