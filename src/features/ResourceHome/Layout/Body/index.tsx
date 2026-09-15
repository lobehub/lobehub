import { Tooltip } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
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
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('library.title')}
          </Text>
        </AccordionTrigger>
        <div
          className={cx(
            'accordion-action',
            accordionStyles.action,
            accordionStyles.actionBorderless,
          )}
        >
          {canCreate ? createButton : <Tooltip title={reason}>{createButton}</Tooltip>}
        </div>
      </AccordionHeader>
      <AccordionPanel>
        <LibraryList />
      </AccordionPanel>
    </AccordionItem>
  );
});

export default SidebarBody;
