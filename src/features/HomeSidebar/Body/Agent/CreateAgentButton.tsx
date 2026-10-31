'use client';

import {
  ActionIcon,
  Block,
  Center,
  cx,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { SessionDefaultGroup } from '@/types/session';

import { useCreateMenuItems } from '../../hooks';
import styles from './CreateAgentButton.module.css';

interface CreateAgentButtonProps {
  className?: string;
  groupId?: string;
  visibility?: 'private' | 'public';
}

const CreateAgentButton = memo<CreateAgentButtonProps>(({ groupId, className, visibility }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason } = usePermission('create_content');
  const {
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
    openCreateAgentModal,
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
    openCreateAgentModal(menuOptions);
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
        <Icon icon={PlusIcon} size={'small'} />
      </Center>
      <Text style={{ flex: 1 }} type={'secondary'}>
        {t('addAgent')}
      </Text>
      {canCreate && (
        <Flexbox
          horizontal
          align={'center'}
          className={styles.actions}
          flex={'none'}
          justify={'flex-end'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DropdownMenu items={dropdownItems}>
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
