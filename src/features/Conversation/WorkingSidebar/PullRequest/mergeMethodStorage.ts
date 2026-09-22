import type { DeviceGitPullRequestMergeMethod } from '@lobechat/types';

export const MERGE_METHOD_STORAGE_KEY = 'lobechat-pr-merge-method';
export const MERGE_METHODS: DeviceGitPullRequestMergeMethod[] = ['squash', 'merge', 'rebase'];

const isMergeMethod = (value: unknown): value is DeviceGitPullRequestMergeMethod =>
  MERGE_METHODS.includes(value as DeviceGitPullRequestMergeMethod);

export const readMergeMethod = (): DeviceGitPullRequestMergeMethod => {
  try {
    const raw = window.localStorage.getItem(MERGE_METHOD_STORAGE_KEY);
    return isMergeMethod(raw) ? raw : 'squash';
  } catch {
    return 'squash';
  }
};

export const writeMergeMethod = (method: DeviceGitPullRequestMergeMethod) => {
  try {
    window.localStorage.setItem(MERGE_METHOD_STORAGE_KEY, method);
  } catch {
    return;
  }
};
