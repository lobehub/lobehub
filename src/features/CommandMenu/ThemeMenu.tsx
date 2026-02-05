import { Command } from 'cmdk';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';
import { useCommandMenu } from './useCommandMenu';

const ThemeMenu = memo(() => {
  const { t } = useTranslation('common');
  const { handleThemeChange } = useCommandMenu();
  const { theme } = useTheme();

  return (
    <>
      <Command.Item value="theme-light" onSelect={() => handleThemeChange('light')}>
        <Sun className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemDetails}>
            <div className={styles.itemLabel}>{t('cmdk.themeLight')}</div>
            {theme === 'light' && (
              <div className={styles.itemDescription}>{t('cmdk.themeCurrent')}</div>
            )}
          </div>
        </div>
      </Command.Item>
      <Command.Item value="theme-dark" onSelect={() => handleThemeChange('dark')}>
        <Moon className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemDetails}>
            <div className={styles.itemLabel}>{t('cmdk.themeDark')}</div>
            {theme === 'dark' && (
              <div className={styles.itemDescription}>{t('cmdk.themeCurrent')}</div>
            )}
          </div>
        </div>
      </Command.Item>
      <Command.Item value="theme-system" onSelect={() => handleThemeChange('system')}>
        <Monitor className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemDetails}>
            <div className={styles.itemLabel}>{t('cmdk.themeAuto')}</div>
            {theme === 'system' && (
              <div className={styles.itemDescription}>{t('cmdk.themeCurrent')}</div>
            )}
          </div>
        </div>
      </Command.Item>
    </>
  );
});

ThemeMenu.displayName = 'ThemeMenu';

export default ThemeMenu;
