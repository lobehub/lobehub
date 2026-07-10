import { Flexbox, SortableList } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useAiInfraStore } from '@/store/aiInfra';
import { type AiProviderListItem } from '@/types/aiProvider';

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
  defaultItems: AiProviderListItem[];
  onCancel: () => void;
  open: boolean;
}
const ConfigGroupModal = memo<ConfigGroupModalProps>(({ open, onCancel, defaultItems }) => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider } = usePermission('manage_provider_key');
  const updateAiProviderSort = useAiInfraStore((s) => s.updateAiProviderSort);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  const [items, setItems] = useState(defaultItems);
  return (
    <ImperativeModal
      allowFullscreen
      footer={null}
      open={open}
      title={t('sortModal.title')}
      width={400}
      onCancel={onCancel}
    >
      <Flexbox gap={16}>
        <SortableList
          items={items}
          renderItem={(item: AiProviderListItem) => (
            <SortableList.Item
              horizontal
              align={'center'}
              className={styles.container}
              gap={4}
              id={item.id}
              justify={'space-between'}
            >
              <GroupItem {...item} disabled={!canManageProvider} />
            </SortableList.Item>
          )}
          onChange={async (items: AiProviderListItem[]) => {
            if (!canManageProvider) return;

            setItems(items);
          }}
        />
        <Button
          block
          disabled={!canManageProvider}
          loading={loading}
          style={{ bottom: 0, position: 'sticky' }}
          type={'primary'}
          onClick={async () => {
            if (!canManageProvider) return;

            const sortMap = items.map((item, index) => ({
              id: item.id,
              sort: index,
            }));
            setLoading(true);
            await updateAiProviderSort(sortMap);
            setLoading(false);
            message.success(t('sortModal.success'));
            onCancel();
          }}
        >
          {t('sortModal.update')}
        </Button>
      </Flexbox>
    </ImperativeModal>
  );
});

export default ConfigGroupModal;
