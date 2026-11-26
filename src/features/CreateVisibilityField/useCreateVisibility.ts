import { useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';

export type CreateVisibility = 'private' | 'public';

export interface CreateVisibilityOptions {
  /** Sidebar folder the new item is created in. */
  groupId?: string;
  /**
   * The caller's context: the folder's visibility when `groupId` is set,
   * otherwise the list the user is looking at (e.g. the Private tab).
   */
  visibility?: CreateVisibility;
}

export interface ResolvedCreateVisibility {
  /** Value the field starts on; `undefined` lets the server decide. */
  initial?: CreateVisibility;
  /** The folder decides, so the field shows its value but cannot change it. */
  locked: boolean;
  /** Visibility only exists inside a workspace. */
  show: boolean;
}

/**
 * Where a new agent / group starts. In a workspace the default is private:
 * a wrong private default is noticed at once and fixed by publishing, while a
 * wrong workspace default silently exposes prompts and knowledge to everyone.
 * Inside a folder the folder decides (the server rejects a mismatch). Nothing
 * is remembered between dialogs, so the default never drifts.
 */
export const resolveCreateVisibility = ({
  groupId,
  inWorkspace,
  visibility,
}: CreateVisibilityOptions & { inWorkspace: boolean }): ResolvedCreateVisibility => {
  if (!inWorkspace) return { initial: visibility, locked: false, show: false };
  // A folder of unknown visibility: leave it to the server's folder inheritance.
  if (groupId) return { initial: visibility, locked: true, show: !!visibility };
  return { initial: visibility ?? 'private', locked: false, show: true };
};

export interface CreateVisibilityState {
  /** Whether the user may create workspace-visible items at all. */
  canPublish: boolean;
  locked: boolean;
  publishBlockedReason?: string;
  setValue: (value: CreateVisibility) => void;
  show: boolean;
  /** What to send to the server; `undefined` lets the server decide. */
  value?: CreateVisibility;
}

/** Form state for the shared "Visibility" field of the create dialogs. */
export const useCreateVisibility = (
  options: CreateVisibilityOptions = {},
): CreateVisibilityState => {
  const inWorkspace = !!useActiveWorkspaceId();
  const { allowed: canPublish, reason: publishBlockedReason } = usePermission('create_content');
  const { initial, locked, show } = resolveCreateVisibility({ ...options, inWorkspace });

  const [value, setValue] = useState<CreateVisibility | undefined>(() =>
    !locked && initial === 'public' && !canPublish ? 'private' : initial,
  );

  return { canPublish, locked, publishBlockedReason, setValue, show, value };
};
