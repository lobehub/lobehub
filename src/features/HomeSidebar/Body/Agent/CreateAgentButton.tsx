'use client';

import { ActionIcon, Block, Center, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { usePermission } from '@/hooks/usePermission';
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
  visibility?: 'private' | 'public';
}

const CreateAgentButton = memo<CreateAgentButtonProps>(({ groupId, className, visibility }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason } = usePermission('create_content');
  const {
    createAgent,
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
    isMutatingAgent,
    openCreateModal,
  } = useCreateMenuItems();

  const isCustomGroup = Boolean(groupId) && groupId !== SessionDefaultGroup.Default;
  // Always carry visibility so agents created inside a private session group
  // land in the private bucket (otherwise they default to public and end up
  // orphaned — invisible in both lists). groupId is only attached for custom
  // groups so the default list keeps creating top-level agents.
  const menuOptions = useMemo(
    () =>
      isCustomGroup || visibility
        ? { ...(isCustomGroup ? { groupId } : {}), ...(visibility ? { visibility } : {}) }
        : undefined,
    [groupId, isCustomGroup, visibility],
  );

  const dropdownItems = useMemo(() => {
    const connectItem = createConnectAgentMenuItem(menuOptions);
    // Discovery entries stay available for the private bucket too — they only
    // navigate (list / market), so the bucket merely decides which tab the
    // agent-list page opens on.
    const showDiscoveryItems = !isCustomGroup;
    return [
      createAgentMenuItem(menuOptions),
      createGroupChatMenuItem(menuOptions),
      ...(connectItem ? [{ type: 'divider' as const }, connectItem] : []),
      ...(showDiscoveryItems
        ? [
            { type: 'divider' as const },
            createAgentListMenuItem(visibility ? { visibility } : undefined),
            createMarketAgentMenuItem(),
          ]
        : []),
    ];
  }, [
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
    isCustomGroup,
    menuOptions,
    visibility,
  ]);

  const handleClick = () => {
    if (!canCreate) return;
    if (openCreateModal) {
      openCreateModal('agent', menuOptions);
    } else {
      createAgent(menuOptions);
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
        {t('addAgent')}
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

  // Wrap in Tooltip when the viewer/member lacks `create_content`. The
  // dropdown is hidden in the disabled state (it'd let users bypass the
  // gate); the main click target is intercepted in `handleClick`.
  return canCreate ? content : <Tooltip title={reason}>{content}</Tooltip>;
});

export default CreateAgentButton;
