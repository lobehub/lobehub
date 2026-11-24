import { Button, Flexbox, Icon, SortableList } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { Plus } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import type { SessionGroupItemBase } from '@/types/session';

import GroupItem from './GroupItem';
import { resolveConfigGroupList } from './sections';

const styles = stylex.create({
  container: {
    height: '36px',
    paddingInline: '8px',
    borderRadius: `${cssVar.borderRadius}px`,
    transition: 'background 0.2s ease-in-out',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

interface ConfigGroupModalProps {
  onCancel?: () => void;
  open?: boolean;
}

/** Manages the folders the sidebar shows; see {@link resolveConfigGroupList}. */
const ConfigGroupModal = memo<ConfigGroupModalProps>(({ open, onCancel }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const isWorkspace = !!useActiveWorkspaceId();
  const groups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const { createVisibility, items: sessionGroupItems } = useMemo(
    () => resolveConfigGroupList({ groups, isWorkspace, privateGroups }),
    [groups, isWorkspace, privateGroups],
  );
  const [addGroup, updateGroupSort] = useHomeStore((s) => [s.addGroup, s.updateGroupSort]);
  const [loading, setLoading] = useState(false);

  return (
    <ImperativeModal
      allowFullscreen
      footer={null}
      open={open}
      title={t('sessionGroup.config')}
      width={400}
      onCancel={onCancel}
    >
      <Flexbox>
        <SortableList
          items={sessionGroupItems}
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
          onChange={(items: SessionGroupItemBase[]) => {
            if (!canEdit) return;

            updateGroupSort(items);
          }}
        />
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
      </Flexbox>
    </ImperativeModal>
  );
});

export default ConfigGroupModal;
