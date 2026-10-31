import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Database, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '64px',
    paddingInline: '24px',
    borderRadius: cssVar.borderRadiusLG,
  },
  iconBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    marginBlockEnd: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
});

interface EmptyStateProps {
  onAddDataset: () => void;
}

const EmptyState = memo<EmptyStateProps>(({ onAddDataset }) => {
  const { t } = useTranslation('eval');

  return (
    <Block className={stylex.props(styles.emptyCard).className} variant={'outlined'}>
      <div {...stylex.props(styles.iconBox)}>
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
