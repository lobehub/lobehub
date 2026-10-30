import type { DeviceGitWorktreeBase } from '@lobechat/types';
import { useDebounce } from 'ahooks';
import useSWR from 'swr';

import { deviceKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';

import { formatWorktreeBase } from './worktreeHelpers';

const BASE_INPUT_DEBOUNCE_MS = 300;

const useResolvedBase = (deviceId: string | undefined, path: string, baseRef?: string) =>
  useSWR(
    deviceKeys.gitWorktreeBase(deviceId, path, baseRef),
    () => gitService.resolveGitWorktreeBase({ baseRef, deviceId, path }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

export interface WorktreeBaseState {
  /** What the worktree would fork from right now, once known. */
  base?: DeviceGitWorktreeBase;
  /** The source HEAD, shown as the field's default. */
  headBase?: DeviceGitWorktreeBase;
  /** The device answered that the typed ref is malformed or doesn't exist. */
  isInvalid: boolean;
  /** A typed ref hasn't been checked yet, or the HEAD read is still in flight. */
  isPending: boolean;
  /** The ref the user typed; undefined means the source HEAD. */
  ref?: string;
  /** The device couldn't answer, e.g. a build too old for this RPC. */
  unavailable: boolean;
}

/**
 * Resolve the create dialog's base field against the device. HEAD is re-read each
 * time the dialog opens rather than trusted from cache: the repo may have moved
 * since, and the field exists to say what the branch will really fork from. A
 * device that can't answer leaves creating from HEAD open but can't take a typed
 * ref: it would ignore one it doesn't understand and silently fork from HEAD.
 */
export const useWorktreeBase = (
  deviceId: string | undefined,
  path: string,
  editedBase: string | undefined,
): WorktreeBaseState => {
  const head = useResolvedBase(deviceId, path);
  const headBase = head.isValidating ? undefined : head.data?.base;

  // Retyping the shown default is the same as never having edited it.
  const trimmed = editedBase?.trim();
  const typed =
    trimmed && !(headBase && trimmed === formatWorktreeBase(headBase)) ? trimmed : undefined;
  const debounced = useDebounce(typed, { wait: BASE_INPUT_DEBOUNCE_MS });
  const edited = useResolvedBase(deviceId, path, debounced);

  if (!typed) {
    return {
      base: headBase,
      headBase,
      isInvalid: false,
      isPending: head.isValidating,
      unavailable: !head.isValidating && !!head.error,
    };
  }

  const isSettled = debounced === typed && !edited.isValidating;
  return {
    base: isSettled ? edited.data?.base : undefined,
    headBase,
    isInvalid: isSettled && !edited.error && !edited.data?.base,
    isPending: !isSettled,
    ref: typed,
    unavailable: isSettled && !!edited.error,
  };
};
