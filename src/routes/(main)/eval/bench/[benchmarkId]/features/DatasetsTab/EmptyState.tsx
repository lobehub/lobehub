import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Card } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Database, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  emptyCard: css`
    .ant-card-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      padding-block: 64px;
      padding-inline: 24px;
    }
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
    <Card className={styles.emptyCard}>
      <div className={styles.iconBox}>
        <Icon icon={Database} size={24} style={{ color: cssVar.colorPrimary }} />
      </div>
      <Flexbox align="center" gap={4}>
        <Text weight={600}>{t('dataset.empty.title')}</Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {t('dataset.empty.description')}
        </Text>
      </Flexbox>
      <Button
        icon={Plus}
        size="small"
        style={{ marginTop: 16 }}
        type="primary"
        onClick={onAddDataset}
      >
        {t('dataset.actions.addDataset')}
      </Button>
    </Card>
  );
});

export default EmptyState;
