'use client';

import { ActionIcon, Block, Center, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { SessionDefaultGroup } from '@/types/session';

import { useCreateMenuItems } from '../../hooks';

const ACTION_CLASS_NAME = 'create-agent-actions';

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

interface CreateAgentButtonProps {
  className?: string;
  groupId?: string;
}

const CreateAgentButton = memo<CreateAgentButtonProps>(({ groupId, className }) => {
  const { t } = useTranslation('chat');
  const {
    createAgent,
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    isMutatingAgent,
    openCreateModal,
  } = useCreateMenuItems();

  const isCustomGroup = Boolean(groupId) && groupId !== SessionDefaultGroup.Default;
  const menuOptions = isCustomGroup ? { groupId } : undefined;

  const dropdownItems = useMemo(() => {
    const heteroItems = createHeterogeneousAgentMenuItems(menuOptions);
    return [
      createAgentMenuItem(menuOptions),
      createGroupChatMenuItem(menuOptions),
      ...(heteroItems.length > 0 ? [{ type: 'divider' as const }, ...heteroItems] : []),
    ];
  }, [
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    menuOptions,
  ]);

  const handleClick = () => {
    if (openCreateModal) {
      openCreateModal('agent', isCustomGroup ? { groupId } : undefined);
    } else {
      createAgent(isCustomGroup ? { groupId } : undefined);
    }
  };

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      className={cx(styles.container, className)}
      gap={8}
      height={32}
      paddingInline={4}
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
    </Block>
  );
});

export default CreateAgentButton;
