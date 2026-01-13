import { Button, Modal, type ModalProps, SortableList } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/store/session';
import { sessionGroupSelectors } from '@/store/session/selectors';
import { type SessionGroupItem } from '@/types/session';

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
  const sessionGroupItems = useSessionStore(sessionGroupSelectors.sessionGroupItems, isEqual);
  const [addSessionGroup, updateSessionGroupSort] = useSessionStore((s) => [
    s.addSessionGroup,
    s.updateSessionGroupSort,
  ]);
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
          onChange={(items: SessionGroupItem[]) => {
            updateSessionGroupSort(items);
          }}
          renderItem={(item: SessionGroupItem) => (
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
            await addSessionGroup(t('sessionGroup.newGroup'));
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
