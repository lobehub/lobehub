import { Button, createStaticStyles, Flexbox, Icon, SortableList } from '@lobehub/ui';
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

interface ConfigGroupModalProps {
  onCancel?: () => void;
  open?: boolean;
  scope?: 'private' | 'public';
}

const ConfigGroupModal = memo<ConfigGroupModalProps>(({ open, onCancel, scope = 'public' }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason: createReason } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const sessionGroupItems = useHomeStore(
    (s) =>
      (scope === 'private'
        ? homeAgentListSelectors.privateAgentGroups(s)
        : homeAgentListSelectors.agentGroups(s)
      ).map(({ id, name, sort }) => ({ id, name, sort })),
    isEqual,
  );
  const [addSessionGroup, updateSessionGroupSort] = useHomeStore((s) => [
    s.addGroup,
    s.updateGroupSort,
  ]);
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
            updateSessionGroupSort(items);
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
            try {
              await addSessionGroup(t('sessionGroup.newGroup'), scope);
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
