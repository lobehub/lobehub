'use client';

import { isDesktop } from '@lobechat/const';
import type { FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import type { SystemMonospaceFont } from '@/services/electron/system';
import { electronSystemService } from '@/services/electron/system';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

const APPLICATION_DEFAULT_FONT = '__application_default__';

const TerminalSettings = memo(() => {
  const { t } = useTranslation('setting');
  const terminalFontFamily = useUserStore(preferenceSelectors.terminalFontFamily);
  const updatePreference = useUserStore((s) => s.updatePreference);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const [systemFonts, setSystemFonts] = useState<SystemMonospaceFont[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);

  useEffect(() => {
    let active = true;

    electronSystemService
      .getSystemMonospaceFonts()
      .then((fonts) => {
        if (!active) return;

        setSystemFonts(fonts);
        setHasLoadError(false);
      })
      .catch((error) => {
        if (!active) return;

        console.error('Failed to load system monospace fonts:', error);
        setHasLoadError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedFont = terminalFontFamily || APPLICATION_DEFAULT_FONT;
  const options = useMemo(() => {
    const fontOptions = [...systemFonts];

    if (terminalFontFamily && !systemFonts.some(({ value }) => value === terminalFontFamily)) {
      fontOptions.unshift({
        label: t('settingAppearance.terminal.fontFamily.unavailable', {
          font: terminalFontFamily,
        }),
        value: terminalFontFamily,
      });
    }

    return [
      {
        label: t('settingAppearance.terminal.fontFamily.default'),
        value: APPLICATION_DEFAULT_FONT,
      },
      ...fontOptions,
    ];
  }, [systemFonts, t, terminalFontFamily]);

  const handleChange = (value: string) => {
    save(() =>
      updatePreference({
        terminalFontFamily: value === APPLICATION_DEFAULT_FONT ? '' : value,
      }),
    );
  };

  const terminal: FormGroupItemType = {
    children: [
      {
        children: (
          <Select
            showSearch
            aria-label={t('settingAppearance.terminal.fontFamily.title')}
            loading={isLoading}
            options={options}
            style={{ width: 320 }}
            value={selectedFont}
            onChange={handleChange}
          />
        ),
        desc: hasLoadError
          ? t('settingAppearance.terminal.fontFamily.loadError')
          : t('settingAppearance.terminal.fontFamily.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-terminal-font'}>
            {t('settingAppearance.terminal.fontFamily.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingAppearance.terminal.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[terminal]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

const Terminal = memo(() => {
  const enableBuiltinTerminal = useUserStore(labPreferSelectors.enableBuiltinTerminal);

  if (!isDesktop || !enableBuiltinTerminal) return null;

  return <TerminalSettings />;
});

export default Terminal;
