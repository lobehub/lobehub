'use client';

import { isDesktop } from '@lobechat/const';
import type { DebugLoggingDuration, DebugLoggingSettings } from '@lobechat/electron-client-ipc';
import { Button, Flexbox, Select, toast } from '@lobehub/ui';
import { type FormFieldProps, type FormValues } from '@lobehub/ui/form';
import { FolderOpen, PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { useExportDiagnostics } from '@/features/Electron/system/useExportDiagnostics';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { desktopSettingsService } from '@/services/electron/settings';

type DebugLoggingChoice = DebugLoggingDuration | 'off';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_TIMED_MS = 60 * 1000;

/** The clock reading the remaining time is measured against, taken when the setting was read. */
type DebugLoggingState = DebugLoggingSettings & { readAt: number };

const fetchDebugLoggingSettings = async (): Promise<DebugLoggingState> => ({
  ...(await desktopSettingsService.getDebugLoggingSettings()),
  readAt: Date.now(),
});

const toChoice = (data: DebugLoggingSettings): DebugLoggingChoice => {
  if (data.alwaysOn) return 'always';
  if (!data.enabled) return 'off';
  return data.expiresAt === undefined ? 'always' : '24h';
};

/**
 * Desktop-only Settings → Advanced diagnostics rows. Exporting the diagnostics zip is
 * the main action; the raw log folder stays one click away for people who want the
 * files. Debug logs run for 24 hours or until turned off, and a timed run ends quietly:
 * the row's description is the only place that shows how long it has left.
 */
export const useDiagnosticsItems = <Values extends FormValues>(): FormFieldProps<Values>[] => {
  const { t } = useTranslation(['setting', 'common']);
  const [updating, setUpdating] = useState(false);
  const { exportDiagnostics, exporting } = useExportDiagnostics();

  const { data, mutate } = useSWR(
    isDesktop ? 'desktop-debug-logging-settings' : null,
    fetchDebugLoggingSettings,
    // A timed run is re-read every minute so the remaining time counts down and the row
    // flips to Off when the main process ends it; SWR pauses this while the window is hidden.
    { refreshInterval: (latest) => (latest?.expiresAt === undefined ? 0 : REFRESH_TIMED_MS) },
  );

  if (!isDesktop) return [];

  const choice = data ? toChoice(data) : undefined;

  const debugLogsDesc = (() => {
    if (!data || choice === 'off') return t('settingAbout.debugLogs.desc');
    if (data.alwaysOn) return t('settingAbout.debugLogs.devDesc');
    if (data.expiresAt === undefined) return t('settingAbout.debugLogs.status.always');
    const hours = Math.round((data.expiresAt - data.readAt) / HOUR_MS);
    return hours >= 1
      ? t('settingAbout.debugLogs.status.hours', { count: hours })
      : t('settingAbout.debugLogs.status.soon');
  })();

  return [
    {
      children: (
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Button icon={FolderOpen} onClick={() => desktopSettingsService.openLogDirectory()}>
            {t('settingAbout.debugLogs.openDirectory')}
          </Button>
          <Button
            icon={PackageOpen}
            loading={exporting}
            type={'primary'}
            onClick={exportDiagnostics}
          >
            {t('diagnostics.export.action', { ns: 'common' })}
          </Button>
        </Flexbox>
      ),
      desc: t('settingAbout.diagnostics.bundle.desc'),
      label: (
        <SettingsSearchAnchor id={'advanced-diagnostics'}>
          {t('settingAbout.diagnostics.bundle.title')}
        </SettingsSearchAnchor>
      ),
      minWidth: undefined,
    },
    {
      children: (
        <Select
          disabled={!data || data.alwaysOn}
          loading={updating}
          style={{ minWidth: 160 }}
          value={choice}
          options={[
            { label: t('settingAbout.debugLogs.option.off'), value: 'off' },
            { label: t('settingAbout.debugLogs.option.24h'), value: '24h' },
            { label: t('settingAbout.debugLogs.option.always'), value: 'always' },
          ]}
          onChange={async (next: DebugLoggingChoice) => {
            setUpdating(true);
            try {
              const settings = await desktopSettingsService.setDebugLogging(next);
              await mutate({ ...settings, readAt: Date.now() }, { revalidate: false });
            } catch (error) {
              console.error('[Diagnostics] failed to update debug logs', error);
              toast.error(t('settingAbout.debugLogs.updateFailed'));
            } finally {
              setUpdating(false);
            }
          }}
        />
      ),
      desc: debugLogsDesc,
      label: (
        <SettingsSearchAnchor id={'advanced-debug-logs'}>
          {t('settingAbout.debugLogs.title')}
        </SettingsSearchAnchor>
      ),
      minWidth: undefined,
    },
  ];
};
