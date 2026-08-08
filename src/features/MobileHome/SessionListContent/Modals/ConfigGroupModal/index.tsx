import { type ModalProps } from '@lobehub/ui';
import { Flexbox, Icon, SortableList } from '@lobehub/ui';
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
import { type SessionGroupItemBase } from '@/types/session';

import GroupItem from './GroupItem';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    height: 36px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const ConfigGroupModal = memo<ModalProps>(({ open, onCancel }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason: createReason } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const [addGroup, updateGroupSort] = useHomeStore((s) => [s.addGroup, s.updateGroupSort]);
  const [loading, setLoading] = useState(false);

  const items: SessionGroupItemBase[] = agentGroups.map((g) => ({
    children: g.items,
    id: g.id,
    name: g.name,
  }));

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
          items={items}
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
          onChange={(newItems: SessionGroupItemBase[]) => {
            if (!canEdit) return;
            updateGroupSort(newItems);
          }}
        />
        <Button
          block
          disabled={!canCreate}
          icon={<Icon icon={Plus} />}
          loading={loading}
          title={createReason}
          onClick={async () => {
            if (!canCreate) return;
            setLoading(true);
            await addGroup(t('sessionGroup.newGroup'));
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
