import { Button, Empty, Flexbox } from '@lobehub/ui';
import { Card } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Activity, Plus } from 'lucide-react';
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
}));

interface EmptyStateProps {
  onCreate: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onCreate }) => {
  const { t } = useTranslation('eval');

  return (
    <Card className={styles.emptyCard}>
      <Empty
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
              {t('run.empty.title')}
            </p>
            <p
              style={{
                color: 'var(--ant-color-text-tertiary)',
                fontSize: 12,
                margin: 0,
              }}
            >
              {t('run.empty.descriptionBenchmark')}
            </p>
          </Flexbox>
        }
        icon={Activity}
      >
        <Button icon={Plus} onClick={onCreate} size="small" style={{ marginTop: 16 }} type="primary">
          {t('run.actions.create')}
        </Button>
      </Empty>
    </Card>
  );
});

export default EmptyState;
