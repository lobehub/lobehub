import { Block, Button, createStaticStyles, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Database, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  emptyCard: css`
    align-items: center;
    justify-content: center;

    padding-block: 64px;
    padding-inline: 24px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  iconBox: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    margin-block-end: 16px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorPrimaryBg};
  `,
}));

interface EmptyStateProps {
  onAddDataset: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onAddDataset }) => {
  const { t } = useTranslation('eval');

  return (
    <Block className={styles.emptyCard} variant={'outlined'}>
      <div className={styles.iconBox}>
        <Icon icon={Database} size={24} style={{ color: cssVar.colorPrimary }} />
      </div>
      <Flexbox align="center" gap={4}>
        <Text weight={600}>{t('dataset.empty.title')}</Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {t('dataset.empty.description')}
        </Text>
      </Flexbox>
      <Button icon={Plus} style={{ marginTop: 16 }} type="primary" onClick={onAddDataset}>
        {t('dataset.actions.addDataset')}
      </Button>
    </Block>
  );
});

export default EmptyState;
