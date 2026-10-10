import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useState } from 'react';

import { useTopicActionsDropdownMenu } from './useDropdownMenu';

const Actions = memo(() => {
  const [open, setOpen] = useState(false);
  const menuItems = useTopicActionsDropdownMenu({ onUploadClose: () => setOpen(false) });

  return (
    <DropdownMenu items={menuItems} open={open} onOpenChange={setOpen}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default Actions;
