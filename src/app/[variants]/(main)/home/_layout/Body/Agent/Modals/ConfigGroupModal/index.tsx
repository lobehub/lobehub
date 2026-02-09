import { Button, Modal, type ModalProps, SortableList } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import GroupItem from './GroupItem';
import { SessionGroupItemBase } from '@/types/session';

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

const ConfigGroupModal = memo<ModalProps>(({ open, onCancel }) => {
  const { t } = useTranslation('chat');
  // Map SidebarGroup to SessionGroupItem-like structure for the sortable list
  const sessionGroupItems = useHomeStore(
    (s) =>
      homeAgentListSelectors.agentGroups(s).map((g) => ({
        id: g.id,
        name: g.name,
        sort: g.sort,
      })),
    isEqual,
  );
  const [addGroup, updateGroupSort] = useHomeStore((s) => [s.addGroup, s.updateGroupSort]);
  const [loading, setLoading] = useState(false);

  return (
    <Modal
      allowFullscreen
      footer={null}
      onCancel={onCancel}
      open={open}
      title={t('sessionGroup.config')}
      width={400}
    >
      <Flexbox>
        <SortableList
          items={sessionGroupItems}
          onChange={(items: SessionGroupItemBase[]) => {
            updateGroupSort(items);
          }}
          renderItem={(item: SessionGroupItemBase) => (
            <SortableList.Item
              align={'center'}
              className={styles.container}
              gap={4}
              horizontal
              id={item.id}
              justify={'space-between'}
            >
              <GroupItem {...item} />
            </SortableList.Item>
          )}
        />
        <Button
          block
          icon={Plus}
          loading={loading}
          onClick={async () => {
            setLoading(true);
            await addGroup(t('sessionGroup.newGroup'));
            setLoading(false);
          }}
        >
          {t('sessionGroup.createGroup')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

export default ConfigGroupModal;
