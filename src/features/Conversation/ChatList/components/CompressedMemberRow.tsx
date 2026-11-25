'use client';

import { memo } from 'react';

import MessageItem from '../../Messages';

interface CompressedMemberRowProps {
  id: string;
  index: number;
}

/**
 * One message of a compression group's original conversation. It renders
 * exactly like the live message it was before compression, so compressing
 * changes nothing on screen, but read-only: the model no longer sees it in
 * full, so editing, regenerating or deleting it would not change the context.
 */
const CompressedMemberRow = memo<CompressedMemberRowProps>(({ id, index }) => (
  // Keep the browser's own menu: the message menu offers edit, delete and
  // regenerate, which only apply to live turns.
  <div onContextMenuCapture={(event) => event.stopPropagation()}>
    <MessageItem disableEditing id={id} index={index} isLatestItem={false} />
  </div>
));

CompressedMemberRow.displayName = 'CompressedMemberRow';

export default CompressedMemberRow;
