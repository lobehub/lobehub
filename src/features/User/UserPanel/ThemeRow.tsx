import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ThemeButton from './ThemeButton';

const ThemeRow = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={12}
      justify={'space-between'}
      style={{
        borderRadius: 8,
        cursor: 'default',
        marginInline: 4,
        paddingBlock: 6,
        paddingInline: 12,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = cssVar.colorFillTertiary as string;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span>{t('settingCommon.themeMode.title')}</span>
      <ThemeButton placement={'right'} size={16} />
    </Flexbox>
  );
});

ThemeRow.displayName = 'ThemeRow';

export default ThemeRow;
