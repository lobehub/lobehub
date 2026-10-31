import * as stylex from '@stylexjs/stylex';
import { ArrowUpDown, CornerDownLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from '../styles';

/**
 * Show avaialble keyboard action for the CMDK Menu.
 */
const CommandFooter = memo(() => {
  const { t } = useTranslation('common');

  return (
    <div {...stylex.props(styles.commandFooter)}>
      <div {...stylex.props(styles.kbd)}>
        <CornerDownLeft {...stylex.props(styles.kbdIcon)} />
        <span>{t('cmdk.toOpen')}</span>
      </div>
      <div {...stylex.props(styles.kbd)}>
        <ArrowUpDown {...stylex.props(styles.kbdIcon)} />
        <span>{t('cmdk.toSelect')}</span>
      </div>
    </div>
  );
});

CommandFooter.displayName = 'CommandFooter';

export default CommandFooter;
