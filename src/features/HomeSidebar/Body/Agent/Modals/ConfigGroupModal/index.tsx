import { Button, Flexbox, Icon, SortableList, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ImperativeModal from '@/components/ImperativeModal';
import PrivateLockIcon from '@/components/PrivateLockIcon';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import type { SessionGroupItemBase } from '@/types/session';

import GroupItem from './GroupItem';
import { resolveConfigGroupSections } from './sections';

const styles = stylex.create({
  container: {
    height: '36px',
    paddingInline: '8px',
    borderRadius: `${cssVar.borderRadius}px`,
    transition: 'background 0.2s ease-in-out',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  sectionTitle: { paddingInline: '8px' },
});

interface GroupSortableListProps {
  canEdit: boolean;
  items: SessionGroupItemBase[];
}

const GroupSortableList = memo<GroupSortableListProps>(({ canEdit, items }) => {
  const updateGroupSort = useHomeStore((s) => s.updateGroupSort);

  return (
    <SortableList
      items={items}
      renderItem={(item: SessionGroupItemBase) => (
        <SortableList.Item
          horizontal
          align={'center'}
          className={stylex.props(styles.container).className}
          gap={4}
          id={item.id}
          justify={'space-between'}
        >
          <GroupItem {...item} disabled={!canEdit} />
        </SortableList.Item>
      )}
      onChange={(next: SessionGroupItemBase[]) => {
        if (!canEdit) return;

        updateGroupSort(next);
      }}
    />
  );
});

interface ConfigGroupModalProps {
  onCancel?: () => void;
  open?: boolean;
}

/**
 * Category management for the Agents section header. See
 * {@link resolveConfigGroupSections} for how a workspace splits the folders;
 * each list is reordered on its own.
 */
const ConfigGroupModal = memo<ConfigGroupModalProps>(({ open, onCancel }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const isWorkspace = !!useActiveWorkspaceId();

  const groups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const addGroup = useHomeStore((s) => s.addGroup);
  const [loading, setLoading] = useState(false);

  const { createVisibility, ownGroups, workspaceGroups } = useMemo(
    () => resolveConfigGroupSections({ groups, isWorkspace, privateGroups }),
    [groups, isWorkspace, privateGroups],
  );
  const showWorkspaceGroups = workspaceGroups.length > 0;

  const addButton = (
    <Button
      block
      disabled={!canEdit}
      icon={<Icon icon={Plus} />}
      loading={loading}
      onClick={async () => {
        if (!canEdit) return;

        setLoading(true);
        try {
          await addGroup(t('sessionGroup.newGroup'), createVisibility);
        } finally {
          setLoading(false);
        }
      }}
    >
      {t('sessionGroup.createGroup')}
    </Button>
  );

  return (
    <ImperativeModal
      allowFullscreen
      footer={null}
      open={open}
      title={t('sessionGroup.config')}
      width={400}
      onCancel={onCancel}
    >
      <Flexbox gap={16}>
        <Flexbox gap={isWorkspace ? 4 : 0}>
          {/* Categories added here are private in a workspace; say so. */}
          {isWorkspace && (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.sectionTitle).className}
              gap={6}
            >
              <Text type={'secondary'}>{t('sessionGroup.myCategories')}</Text>
              <PrivateLockIcon />
            </Flexbox>
          )}
          <GroupSortableList canEdit={canEdit} items={ownGroups} />
          {addButton}
        </Flexbox>
        {showWorkspaceGroups && (
          <Flexbox gap={4}>
            <Text {...stylex.props(styles.sectionTitle)} type={'secondary'}>
              {t('sessionGroup.workspaceCategories')}
            </Text>
            <GroupSortableList canEdit={canEdit} items={workspaceGroups} />
          </Flexbox>
        )}
      </Flexbox>
    </ImperativeModal>
  );
});

export default ConfigGroupModal;
