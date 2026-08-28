import { type ModalProps, SortableList } from '@lobehub/ui';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import type { SessionGroupItemBase } from '@/types/session';

import GroupItem from './GroupItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    height: 36px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius}px;
    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface ConfigGroupModalProps extends ModalProps {
  scope?: 'private' | 'public';
}

const ConfigGroupModal = memo<ConfigGroupModalProps>(({ open, onCancel, scope = 'public' }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('edit_own_content');
  // Map SidebarGroup to SessionGroupItem-like structure for the sortable list
  const sessionGroupItems = useHomeStore(
    (s) =>
      (scope === 'private'
        ? homeAgentListSelectors.privateAgentGroups(s)
        : homeAgentListSelectors.agentGroups(s)
      ).map((g) => ({
        id: g.id,
        name: g.name,
        sort: g.sort,
      })),
    isEqual,
  ) as SessionGroupItemBase[];
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
              className={styles.container}
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
            await addGroup(t('sessionGroup.newGroup'), scope === 'private' ? 'private' : undefined);
            setLoading(false);
          }}
        >
          {t('sessionGroup.createGroup')}
        </Button>
      </Flexbox>
    </ImperativeModal>
  );
});

export default ConfigGroupModal;
