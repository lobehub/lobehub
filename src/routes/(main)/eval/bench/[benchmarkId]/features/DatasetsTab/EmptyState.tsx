import { Button, Empty, Flexbox } from '@lobehub/ui';
import { Card } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Database, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
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
}));

interface EmptyStateProps {
  onAddDataset: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onAddDataset }) => {
  const { t } = useTranslation('eval');

  return (
    <Card className={styles.emptyCard}>
      <Empty
        icon={Database}
        description={
          <Flexbox gap={4}>
            <p
              style={{
                color: 'var(--ant-color-text)',
                fontSize: 14,
                fontWeight: 500,
                margin: 0,
              }}
            >
              {t('dataset.empty.title')}
            </p>
            <p
              style={{
                color: 'var(--ant-color-text-tertiary)',
                fontSize: 12,
                margin: 0,
              }}
            >
              {t('dataset.empty.description')}
            </p>
          </Flexbox>
        }
      >
        <Button icon={Plus} size="small" style={{ marginTop: 16 }} type="primary" onClick={onAddDataset}>
          {t('dataset.actions.addDataset')}
        </Button>
      </Empty>
    </Card>
  );
});

export default EmptyState;
