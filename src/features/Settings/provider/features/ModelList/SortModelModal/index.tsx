import { Button, Flexbox, SortableList, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type AiProviderModelListItem } from 'model-bank';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useAiInfraStore } from '@/store/aiInfra';

import ListItem from './ListItem';

const styles = stylex.create({
  container: {
    height: '36px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background 0.2s ease-in-out',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
});

interface SortModelModalProps {
  defaultItems: AiProviderModelListItem[];
  onCancel: () => void;
  open: boolean;
}
const SortModelModal = memo<SortModelModalProps>(({ open, onCancel, defaultItems }) => {
  const { t } = useTranslation('modelProvider');
  const { allowed: canManageProvider } = usePermission('manage_provider_key');
  const [providerId, updateAiModelsSort] = useAiInfraStore((s) => [
    s.activeAiProvider,
    s.updateAiModelsSort,
  ]);
  const [loading, setLoading] = useState(false);

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
          renderItem={(item: AiProviderModelListItem) => (
            <SortableList.Item
              horizontal
              align={'center'}
              className={stylex.props(styles.container).className}
              gap={4}
              id={item.id}
              justify={'space-between'}
            >
              <ListItem {...item} disabled={!canManageProvider} />
            </SortableList.Item>
          )}
          onChange={async (items: AiProviderModelListItem[]) => {
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
            if (!providerId) return;

            const sortMap = items.map((item, index) => ({
              id: item.id,
              sort: index,
              type: item.type,
            }));

            setLoading(true);
            await updateAiModelsSort(providerId, sortMap);
            setLoading(false);
            toast.success(t('sortModal.success'));
            onCancel();
          }}
        >
          {t('sortModal.update')}
        </Button>
      </Flexbox>
    </ImperativeModal>
  );
});

export default SortModelModal;
