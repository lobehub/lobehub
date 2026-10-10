import { type EnvironmentKind } from '@lobechat/types';
import {
  compareInstancesForDefault,
  pickDefaultInstance,
} from '@lobechat/utils/environmentInstance';

/**
 * How the composer's environment picker reads an environment and its copies.
 *
 * Kept apart from the component because these are the rules people will ask
 * about — "why did it pick that copy", "why can't I pick this one" — and a rule
 * spread across JSX is one nobody can test without rendering a menu.
 *
 * "Copy" is the product's word for an instance: the data layer and the API keep
 * calling it an instance, and so does this file wherever it touches them.
 */

/** The fields of a listed instance these rules read. */
export interface PickerCopy {
  createdAt: Date | string;
  environmentId: string;
  id: string;
  /** Held by some sandbox run, this conversation's own included. */
  inUse: boolean;
  /** Held by this conversation's own run. */
  inUseByThisTopic: boolean;
  status: string;
}

/**
 * Somebody else's run holds it. The execution plane allows one writer per
 * instance and answers the second with 409 INSTANCE_IN_USE, so offering it would
 * offer a choice the next message refuses. This conversation's own run is the
 * opposite case and never counts.
 */
export const isCopyOccupied = (copy: PickerCopy) => copy.inUse && !copy.inUseByThisTopic;

/** A build holds the same single-writer lease while it publishes. */
export const isCopyBuilding = (copy: PickerCopy) => copy.status === 'pending';

/**
 * Whether a conversation can start using this copy now. A failed build is
 * still free: a conversation pointed at it is how someone gets back to it.
 */
export const isCopyFree = (copy: PickerCopy) => !isCopyOccupied(copy) && !isCopyBuilding(copy);

/** The default copy first, then the others in the order they were made. */
export const sortCopies = <T extends PickerCopy>(copies: readonly T[]): T[] =>
  copies.toSorted(compareInstancesForDefault);

/**
 * The copy a click on the environment row binds, in order:
 *
 * 1. the copy this conversation is already bound to in this environment — a
 *    click on the row it is already in must not move its files;
 * 2. the default copy, when it is free;
 * 3. the first free copy after it.
 *
 * `undefined` when every copy is held or building: the row is then not
 * selectable, and the way forward is to stop a run or open another copy.
 */
export const pickCopyForEnvironment = <T extends PickerCopy>(
  copies: readonly T[],
  boundInstanceId: string | undefined,
): T | undefined => {
  const bound = boundInstanceId ? copies.find((copy) => copy.id === boundInstanceId) : undefined;
  if (bound) return bound;

  const defaultCopy = pickDefaultInstance(copies);
  if (defaultCopy && isCopyFree(defaultCopy)) return defaultCopy;

  return sortCopies(copies).find(isCopyFree);
};

/** The `⋮` menu of an environment row or a copy row. */
export type CopyMenuAction = 'reopen' | 'stop';

/**
 * Which actions the `⋮` menu offers for a copy.
 *
 * Both are the environment creator's alone — the server checks the same owner
 * on `stopInstance` and `createInstanceForEnvironment` — so a colleague on a
 * published environment gets no menu and waits. "Open another copy" rebuilds
 * from the environment's specification, and a files environment's
 * specification holds no files: it would hand back an empty folder, so a files
 * environment can only be stopped.
 */
export const copyMenuActions = ({
  copy,
  isCreator,
  kind,
}: {
  /** The copy the menu acts on; absent on an environment with no copy yet. */
  copy?: PickerCopy;
  isCreator: boolean;
  kind: EnvironmentKind;
}): CopyMenuAction[] => {
  if (!isCreator) return [];

  const actions: CopyMenuAction[] = [];
  // A build cannot be stopped from here — it is not a conversation's run.
  if (copy && isCopyOccupied(copy) && !isCopyBuilding(copy)) actions.push('stop');
  if (kind === 'code') actions.push('reopen');

  return actions;
};

export interface EnvironmentRowState<T extends PickerCopy> {
  /** The copies, default first. */
  copies: T[];
  /** The copy whose state the row shows: the one a click binds, else the default. */
  displayed?: T;
  /**
   * Only for a code environment with several copies: one copy needs no second
   * menu to choose it, and a files environment is one folder for one
   * conversation at a time — the click still lands on the copy it is bound to.
   */
  hasSubmenu: boolean;
  /**
   * No copy yet, and the person may make one: an environment from before every
   * environment got a default copy. Picking it creates that copy first.
   */
  lazyCreate: boolean;
  /** The copy a click on the row binds. */
  picked?: T;
  /** Whether a click on the row does anything. */
  selectable: boolean;
}

/**
 * Everything an environment row needs, from its copies.
 *
 * The row's state is the state of the copy it would bind — the one the person
 * is actually choosing — and falls back to the default copy's when every copy
 * is taken, so the row says why it is blocked.
 */
export const describeEnvironmentRow = <T extends PickerCopy>({
  boundInstanceId,
  copies,
  isCreator,
  kind,
}: {
  boundInstanceId?: string;
  copies: readonly T[];
  isCreator: boolean;
  kind: EnvironmentKind;
}): EnvironmentRowState<T> => {
  const sorted = sortCopies(copies);
  const picked = pickCopyForEnvironment(sorted, boundInstanceId);

  if (sorted.length === 0) {
    // Only the creator can make the copy; a colleague looking at a published
    // environment whose creator never made one has nothing to run in.
    return {
      copies: sorted,
      hasSubmenu: false,
      lazyCreate: isCreator,
      selectable: isCreator,
    };
  }

  return {
    copies: sorted,
    displayed: picked ?? sorted[0],
    hasSubmenu: kind === 'code' && sorted.length > 1,
    lazyCreate: false,
    picked,
    selectable: Boolean(picked),
  };
};

/**
 * The chip's words for a bound copy. The environment is what people chose, so
 * it leads; the copy is named only when there is more than one to tell apart.
 */
export const copyChipLabel = ({
  copy,
  copyCount,
  environmentName,
}: {
  copy: { name: string };
  copyCount: number;
  environmentName?: string;
}): string => {
  if (!environmentName) return copy.name;
  if (copyCount <= 1) return environmentName;

  return `${environmentName} · ${copy.name}`;
};
