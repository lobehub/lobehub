'use client';

import { memo } from 'react';

import { useWorkspaceMentionNotifier } from './useWorkspaceMentionNotifier';

/** Desktop-only: pops an OS notification when a workspace member @-mentions the user. */
const WorkspaceMentionNotifier = memo(() => {
  useWorkspaceMentionNotifier();

  return null;
});

WorkspaceMentionNotifier.displayName = 'WorkspaceMentionNotifier';

export default WorkspaceMentionNotifier;
