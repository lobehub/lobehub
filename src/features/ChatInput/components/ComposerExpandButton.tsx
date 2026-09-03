'use client';

import { memo } from 'react';

import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import ExpandButton from '../SendArea/ExpandButton';
import { useChatInputStore } from '../store';

/**
 * The expand toggle, gated the way the send area used to gate it. It sits in
 * the composer's left slot: the right side is reserved for the model chip and
 * Send, and an audio session takes the whole bar over.
 */
const ComposerExpandButton = memo(() => {
  const { canShowControls } = useChatInputResourceAccess();
  const allowExpand = useChatInputStore((s) => s.allowExpand);
  const audioInputActive = useChatInputStore((s) => s.activeAudioInputMode !== undefined);

  if (!canShowControls || !allowExpand || audioInputActive) return null;

  return <ExpandButton />;
});

ComposerExpandButton.displayName = 'ComposerExpandButton';

export default ComposerExpandButton;
