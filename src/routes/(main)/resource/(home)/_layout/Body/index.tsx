import { AccordionItem, ActionIcon, Text, Tooltip } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';

import LibraryList from './LibraryList';

const SidebarBody = memo<{ itemKey: string }>(({ itemKey }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();

  const { open } = useCreateNewModal();
  const { allowed: canCreate, reason } = usePermission('create_content');

  const handleCreate = () => {
    if (!canCreate) return;
    open({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  const createButton = (
    <ActionIcon
      disabled={!canCreate}
      icon={PlusIcon}
      size={'small'}
      title={canCreate ? t('library.new') : undefined}
      onClick={handleCreate}
    />
  );

  return (
    <AccordionItem
      action={canCreate ? createButton : <Tooltip title={reason}>{createButton}</Tooltip>}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {t('library.title')}
        </Text>
      }
    >
      <LibraryList />
    </AccordionItem>
  );
});

export default SidebarBody;
