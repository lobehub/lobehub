'use client';

import { ActionIcon, Block, Center, DropdownMenu, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { usePermission } from '@/hooks/usePermission';

import { useCreateMenuItems } from '../../hooks';

const ACTION_CLASS_NAME = 'create-private-actions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    .${ACTION_CLASS_NAME} {
      width: 0;
      margin-inline-end: 2px;
      opacity: 0;
      transition: opacity 0.2s ${cssVar.motionEaseOut};

      &:has([data-popup-open]) {
        width: unset;
        opacity: 1;
      }
    }

    &:hover {
      .${ACTION_CLASS_NAME} {
        width: unset;
        opacity: 1;
      }
    }
  `,
}));

interface CreatePrivateButtonProps {
  className?: string;
}

// "+ Add new" entry inside the Private section. Mirrors
// CreateAgentButton but every create entry it produces is hard-pinned to
// `visibility: 'private'` so nothing leaks into the workspace-shared
// bucket. Acts as both the visible affordance for the empty private list
// and the trailing entry for a populated one.
const CreatePrivateButton = memo<CreatePrivateButtonProps>(({ className }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason } = usePermission('create_content');
  const {
    createAgent,
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPlatformAgentMenuItem,
    isMutatingAgent,
    openCreateModal,
  } = useCreateMenuItems();

  const dropdownItems = useMemo(() => {
    const platformItem = createPlatformAgentMenuItem({ visibility: 'private' });
    return [
      createAgentMenuItem({ visibility: 'private' }),
      createGroupChatMenuItem({ visibility: 'private' }),
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [createAgentMenuItem, createGroupChatMenuItem, createPlatformAgentMenuItem]);

  const handleClick = () => {
    if (!canCreate) return;
    if (openCreateModal) {
      openCreateModal('agent', { visibility: 'private' });
    } else {
      createAgent({ visibility: 'private' });
    }
  };

  const content = (
    <Block
      horizontal
      align={'center'}
      className={cx(styles.container, className)}
      clickable={canCreate}
      gap={8}
      height={36}
      paddingInline={4}
      style={canCreate ? { height: 36 } : { cursor: 'not-allowed', height: 36, opacity: 0.5 }}
      variant={'borderless'}
      onClick={handleClick}
    >
      <Center flex={'none'} height={28} width={28}>
        {isMutatingAgent ? (
          <NeuralNetworkLoading size={14} />
        ) : (
          <Icon icon={PlusIcon} size={'small'} />
        )}
      </Center>
      <Text style={{ flex: 1 }} type={'secondary'}>
        {t('newAgent')}
      </Text>
      {canCreate && (
        <Flexbox
          horizontal
          align={'center'}
          className={ACTION_CLASS_NAME}
          flex={'none'}
          justify={'flex-end'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DropdownMenu items={dropdownItems} nativeButton={false}>
            <ActionIcon
              color={cssVar.colorTextQuaternary}
              icon={ChevronDownIcon}
              size={'small'}
              style={{ flex: 'none' }}
            />
          </DropdownMenu>
        </Flexbox>
      )}
    </Block>
  );

  return canCreate ? content : <Tooltip title={reason}>{content}</Tooltip>;
});

export default CreatePrivateButton;
