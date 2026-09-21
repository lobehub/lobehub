import {
  COMPLETION_BUILTIN_SOUNDS,
  type CompletionSoundSettings,
} from '@lobechat/electron-client-ipc';
import { Flexbox, Form } from '@lobehub/ui';
import { Alert, Button, Segmented, Select, Skeleton, Slider, Switch } from '@lobehub/ui/base-ui';
import { Play } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BusinessNotification from '@/business/client/BusinessSettingPages/Notification';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { completionSoundService } from '@/services/electron/completionSound';
import { desktopNotificationService } from '@/services/electron/desktopNotification';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const IMPORTED = 'imported';
const IMPORT = 'import';

export const DesktopNotificationSettings = () => {
  const { t } = useTranslation('setting');
  const soundToggleId = useId();
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const [settings, setSettings] = useState<CompletionSoundSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const report = useCallback(async (action: () => Promise<CompletionSoundSettings | void>) => {
    setError(false);
    try {
      const next = await action();
      if (next) setSettings(next);
    } catch (error) {
      console.error('Completion sound setting failed:', error);
      setError(true);
    }
  }, []);

  /** Only state-changing actions lock the form; playing a sound changes nothing. */
  const run = async (action: () => Promise<CompletionSoundSettings | void>) => {
    setBusy(true);
    try {
      await report(action);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void report(completionSoundService.getSettings);
  }, [report]);

  const previewBanner = () =>
    report(async () => {
      const result = await desktopNotificationService.showNotification({
        body: t('completionSound.banner.previewBody'),
        // Settings is open, so the window has focus and the banner would be skipped.
        force: true,
        soundName: await completionSoundService.getNotificationSoundFile(),
        title: t('completionSound.banner.previewTitle'),
      });
      // A refused banner resolves instead of throwing, so an undelivered preview would
      // otherwise look like a dead button.
      if (!result?.success) throw new Error(result?.error ?? result?.reason ?? 'not delivered');
    });

  return (
    <>
      {error && (
        <Alert
          description={t('completionSound.error')}
          type={'error'}
          action={
            <Button onClick={() => run(completionSoundService.getSettings)}>
              {t('completionSound.retry')}
            </Button>
          }
        />
      )}
      {!settings ? (
        !error && <Skeleton.Text rows={3} />
      ) : (
        <Form
          collapsible={false}
          itemMinWidth={FORM_STYLE.itemMinWidth}
          itemsType={'group'}
          style={FORM_STYLE.style}
          variant={'filled'}
          items={[
            {
              children: [
                {
                  children: (
                    <Flexbox horizontal justify={'flex-end'}>
                      <Switch
                        checked={settings.enabled}
                        disabled={busy}
                        id={soundToggleId}
                        onChange={(enabled) =>
                          run(() => completionSoundService.setSettings({ enabled }))
                        }
                      />
                    </Flexbox>
                  ),
                  desc: t('completionSound.desc'),
                  htmlFor: soundToggleId,
                  label: (
                    <SettingsSearchAnchor id={'notification-completion-sound'}>
                      {t('completionSound.enabled')}
                    </SettingsSearchAnchor>
                  ),
                },
                {
                  children: (
                    <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
                      <Select
                        disabled={busy}
                        value={settings.name ? IMPORTED : settings.builtin}
                        options={[
                          ...(settings.name ? [{ label: settings.name, value: IMPORTED }] : []),
                          ...COMPLETION_BUILTIN_SOUNDS.map((value) => ({
                            label: t(`completionSound.builtin.${value}`),
                            value,
                          })),
                          { label: t('completionSound.import'), value: IMPORT },
                        ]}
                        onChange={(value) => {
                          if (value === IMPORT) return run(completionSoundService.importSound);
                          const builtin = COMPLETION_BUILTIN_SOUNDS.find((id) => id === value);
                          if (builtin) run(() => completionSoundService.setSettings({ builtin }));
                        }}
                      />
                      <Button
                        disabled={settings.volume === 0}
                        icon={Play}
                        title={t('completionSound.preview')}
                        onClick={() => report(() => completionSoundService.play({ preview: true }))}
                      />
                    </Flexbox>
                  ),
                  desc: t('completionSound.importHint'),
                  label: t('completionSound.sound'),
                },
                {
                  children: (
                    <Slider
                      aria-label={t('completionSound.volume')}
                      disabled={busy}
                      max={1}
                      min={0}
                      step={0.1}
                      style={{ width: '100%' }}
                      value={settings.volume}
                      onChange={(volume) => setSettings({ ...settings, volume })}
                      onChangeComplete={(volume) =>
                        run(() => completionSoundService.setSettings({ volume }))
                      }
                    />
                  ),
                  label: t('completionSound.volume'),
                },
              ],
              title: t('completionSound.title'),
            },
            {
              children: [
                {
                  children: (
                    <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
                      <Button
                        icon={Play}
                        title={t('completionSound.preview')}
                        onClick={previewBanner}
                      />
                      <Segmented<CompletionSoundSettings['notificationSound']>
                        disabled={busy}
                        value={settings.notificationSound}
                        options={[
                          { label: t('completionSound.banner.system'), value: 'system' },
                          { label: t('completionSound.banner.lobehub'), value: 'lobehub' },
                        ]}
                        onChange={(notificationSound) =>
                          run(() => completionSoundService.setSettings({ notificationSound }))
                        }
                      />
                    </Flexbox>
                  ),
                  desc: settings.systemSoundDisabled
                    ? t('completionSound.banner.systemMuted')
                    : t('completionSound.banner.desc'),
                  label: (
                    <SettingsSearchAnchor id={'notification-banner-sound'}>
                      {t('completionSound.banner.label')}
                    </SettingsSearchAnchor>
                  ),
                },
              ],
              title: t('completionSound.banner.title'),
            },
          ]}
        />
      )}
      {enableBusinessFeatures && <BusinessNotification />}
    </>
  );
};
