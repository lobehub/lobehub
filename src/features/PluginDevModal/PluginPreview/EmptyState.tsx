import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    padding: cssVar.paddingLG,
  },
  description: { color: cssVar.colorTextSecondary, textAlign: 'center' },
  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorPrimaryBg,
  },
  line: {
    height: '6px',
    borderRadius: '3px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  title: { marginBlockEnd: cssVar.marginXS, fontSize: cssVar.fontSizeLG, fontWeight: 500 },
});

export default function PluginEmptyState() {
  const { t } = useTranslation('plugin');

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.iconWrapper)}>
        <Icon icon={Puzzle} size={32} />
      </div>
      <Text as={'h4'} className={stylex.props(styles.title).className}>
        {t('dev.preview.empty.title')}
      </Text>
      <Text className={stylex.props(styles.description).className}>
        {t('dev.preview.empty.desc')}
      </Text>
      <Flexbox align={'center'} gap={8}>
        <div className={stylex.props(styles.line).className} style={{ width: 128 }} />
        <div className={stylex.props(styles.line).className} style={{ width: 96 }} />
        <div className={stylex.props(styles.line).className} style={{ width: 48 }} />
      </Flexbox>
    </div>
  );
}
