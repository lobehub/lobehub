import { ActionIcon, Dropdown } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo, useState } from 'react';

import { useFileItemDropdown } from './useFileItemDropdown';

interface DropdownMenuProps {
  fileType: string;
  filename: string;
  id: string;
  knowledgeBaseId?: string;
  onRenameStart?: () => void;
  sourceType?: string;
  url: string;
}

const DropdownMenu = memo<DropdownMenuProps>(
  ({ id, knowledgeBaseId, url, filename, fileType, sourceType, onRenameStart }) => {
    const [isOpen, setIsOpen] = useState(false);

    // Only compute dropdown items when dropdown is actually open
    // This prevents expensive hook execution for all 20-25 visible items
    const { menuItems } = useFileItemDropdown({
      enabled: isOpen,
      fileType,
      filename,
      id,
      knowledgeBaseId,
      onRenameStart,
      sourceType,
      url,
    });

    return (
      <Dropdown menu={{ items: menuItems }} onOpenChange={setIsOpen} open={isOpen}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
      </Dropdown>
    );
  },
);

export default DropdownMenu;
