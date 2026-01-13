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
    <div className={styles.commandFooter}>
      <div className={styles.kbd}>
        <CornerDownLeft className={styles.kbdIcon} />
        <span>{t('cmdk.toOpen')}</span>
      </div>
      <div className={styles.kbd}>
        <ArrowUpDown className={styles.kbdIcon} />
        <span>{t('cmdk.toSelect')}</span>
      </div>
    </div>
  );
});

CommandFooter.displayName = 'CommandFooter';

export default CommandFooter;
