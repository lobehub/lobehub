import { Command } from 'cmdk';
import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';
import { useCommandMenu } from './useCommandMenu';

const ThemeMenu = memo(() => {
  const { t } = useTranslation('common');
  const { handleThemeChange } = useCommandMenu();

  return (
    <>
      <Command.Item onSelect={() => handleThemeChange('light')} value="theme-light">
        <Sun className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('cmdk.themeLight')}</div>
        </div>
      </Command.Item>
      <Command.Item onSelect={() => handleThemeChange('dark')} value="theme-dark">
        <Moon className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('cmdk.themeDark')}</div>
        </div>
      </Command.Item>
      <Command.Item onSelect={() => handleThemeChange('system')} value="theme-system">
        <Monitor className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>{t('cmdk.themeAuto')}</div>
        </div>
      </Command.Item>
    </>
  );
});

ThemeMenu.displayName = 'ThemeMenu';

export default ThemeMenu;
