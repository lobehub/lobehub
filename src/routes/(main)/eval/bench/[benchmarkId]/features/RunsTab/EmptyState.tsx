import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Activity, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  emptyCard: css`
    align-items: center;
    justify-content: center;

    padding-block: 64px;
    padding-inline: 24px;
    border: 1px dashed ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: center;

    background: ${cssVar.colorFillQuaternary};
  `,
  iconBox: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface EmptyStateProps {
  onCreate: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onCreate }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={styles.emptyCard} gap={16}>
      <div className={styles.iconBox}>
        <Icon icon={Activity} size={28} style={{ color: cssVar.colorTextTertiary }} />
      </div>
      <Flexbox align="center" gap={4}>
        <Text weight={600}>{t('run.empty.title')}</Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {t('run.empty.descriptionBenchmark')}
        </Text>
      </Flexbox>
      <Button icon={Plus} size="small" type="primary" onClick={onCreate}>
        {t('run.actions.create')}
      </Button>
    </Flexbox>
  );
});

export default EmptyState;
