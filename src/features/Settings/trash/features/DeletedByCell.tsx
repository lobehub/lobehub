'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';

const AVATAR_SIZE = 20;
const AVATAR_GAP = 6;

/** Where the name starts: the column header and the dash line up with it. */
export const DELETED_BY_TEXT_INSET = AVATAR_SIZE + AVATAR_GAP;

interface DeletedByCellProps {
  userId: string | null;
}

/**
 * Who moved a root into the public side of a workspace bin, which lists every
 * member's deletions; a removed member or an unloaded roster shows a dash.
 */
const DeletedByCell = ({ userId }: DeletedByCellProps) => {
  const author = useAuthorInfo(userId ?? undefined);
  const name = author?.fullName;

  if (!name)
    return (
      <Text style={{ paddingInlineStart: DELETED_BY_TEXT_INSET }} type={'secondary'}>
        —
      </Text>
    );

  return (
    <Flexbox horizontal align={'center'} gap={AVATAR_GAP} style={{ minWidth: 0 }}>
      <Avatar
        avatar={author.avatar || name}
        size={AVATAR_SIZE}
        style={{ flexShrink: 0 }}
        title={name}
      />
      <Text ellipsis={{ tooltip: name, tooltipWhenOverflow: true }} type={'secondary'}>
        {name}
      </Text>
    </Flexbox>
  );
};

export default DeletedByCell;
