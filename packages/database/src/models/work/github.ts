import type {
  GithubWorkPatchField,
  GithubWorkVersionSnapshot,
  RegisterGithubWorkParams,
} from '@lobechat/types';

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
      description: pick('description', params.description, null),
      identifier: pick('identifier', params.identifier, null),
      number: pick('number', params.number, null),
      repo: pick('repo', params.repo, null),
      status: pick('status', params.status, null),
      title: pick('title', params.title, null),
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
  type: 'github',
});
