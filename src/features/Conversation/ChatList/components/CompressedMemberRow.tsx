'use client';

import { memo } from 'react';

import MessageItem from '../../Messages';
import { KeepActionRowSpaceContext } from '../../Messages/Contexts/KeepActionRowSpaceContext';

interface CompressedMemberRowProps {
  id: string;
  index: number;
}

/**
 * One message of a compression group's original conversation. It renders
 * exactly like the live message it was before compression, down to the room of
 * its action bar, so compressing changes nothing on screen. It is read-only:
 * the model no longer sees it in full, so editing, regenerating or deleting it
 * would not change the context. Multi-select skips it for the same reason.
 */
const CompressedMemberRow = memo<CompressedMemberRowProps>(({ id, index }) => (
  <KeepActionRowSpaceContext value>
    {/* Keep the browser's own menu: the message menu offers edit, delete and
        regenerate, which only apply to live turns. */}
    <div onContextMenuCapture={(event) => event.stopPropagation()}>
      <MessageItem disableEditing disableSelection id={id} index={index} isLatestItem={false} />
    </div>
  </KeepActionRowSpaceContext>
));

CompressedMemberRow.displayName = 'CompressedMemberRow';

export default CompressedMemberRow;
