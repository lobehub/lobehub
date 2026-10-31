import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Activity, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '64px',
    paddingInline: '24px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  iconBox: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

interface EmptyStateProps {
  onCreate: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onCreate }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={stylex.props(styles.emptyCard).className} gap={16}>
      <div {...stylex.props(styles.iconBox)}>
        <Icon icon={Activity} size={28} style={{ color: cssVar.colorTextTertiary }} />
      </div>
      <Flexbox align="center" gap={4}>
        <Text weight={600}>{t('run.empty.title')}</Text>
        <Text color={cssVar.colorTextTertiary} fontSize={12}>
          {t('run.empty.descriptionBenchmark')}
        </Text>
      </Flexbox>
      <Button icon={Plus} type="primary" onClick={onCreate}>
        {t('run.actions.create')}
      </Button>
    </Flexbox>
  );
});

export default EmptyState;
