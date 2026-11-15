'use client';

import { conversationConfigSchema, livekitConnectionSchema } from '@lobechat/livekit-bridge';
import { Alert, Button, Flexbox, Input, InputPassword, Select, Switch } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import TTSVoiceSelect from '@/features/Settings/provider/features/ModelList/CreateNewModelModal/TTSVoiceSelect';
import { livekitService } from '@/services/livekit';
import { useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const Page = ({ showSettingHeader = true }: { showSettingHeader?: boolean }) => {
  const { t } = useTranslation('setting');
  const settings = useUserStore(settingsSelectors.currentSettings);
  const ready = useUserStore((s) => s.isUserStateInit);
  const [connection, setConnection] = useState({ url: '', apiKey: '', apiSecret: '' });
  const [config, setConfig] = useState(() => conversationConfigSchema.parse({}));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'connected' | 'error'>();
  const form = useForm();
  const models = useAiInfraStore((s) => s.enabledAiModels);
  const selectedModel = models?.find(
    (m) => m.id === config.tts.model && m.providerId === config.tts.provider,
  );
  const providers = useAiInfraStore((s) => s.enabledAiProviders);
  useEffect(() => {
    if (!ready) return;
    setConnection({ url: '', apiKey: '', apiSecret: '', ...settings.keyVaults?.livekit });
    setConfig(conversationConfigSchema.parse(settings.general?.conversation ?? {}));
  }, [ready, settings.general?.conversation, settings.keyVaults?.livekit]);
  const save = async (test: boolean) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const livekit = livekitConnectionSchema.parse(connection);
      const conversation = conversationConfigSchema.parse(config);
      await useUserStore
        .getState()
        .setSettings({ keyVaults: { livekit }, general: { conversation } });
      if (test) await livekitService.checkConnection();
      setFeedback(test ? 'connected' : 'saved');
    } catch {
      setFeedback('error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.conversation')} />}
      <Flexbox gap={16}>
        <Alert title={t('conversation.description')} type="info" />
        <Form
          {...FORM_STYLE}
          collapsible={false}
          form={form}
          itemsType="group"
          variant="filled"
          items={[
            {
              title: t('conversation.connection'),
              children: [
                {
                  label: t('conversation.url'),
                  children: (
                    <Input
                      disabled={!ready || busy}
                      placeholder="wss://your-project.livekit.cloud"
                      value={connection.url}
                      onChange={(e) => setConnection({ ...connection, url: e.target.value })}
                    />
                  ),
                },
                {
                  label: t('conversation.apiKey'),
                  children: (
                    <InputPassword
                      autoComplete="off"
                      disabled={!ready || busy}
                      value={connection.apiKey}
                      onChange={(e) => setConnection({ ...connection, apiKey: e.target.value })}
                    />
                  ),
                },
                {
                  label: t('conversation.apiSecret'),
                  children: (
                    <InputPassword
                      autoComplete="new-password"
                      disabled={!ready || busy}
                      value={connection.apiSecret}
                      onChange={(e) => setConnection({ ...connection, apiSecret: e.target.value })}
                    />
                  ),
                },
              ],
            },
            {
              title: t('conversation.preferences'),
              children: [
                {
                  label: t('conversation.enabled'),
                  children: (
                    <Switch
                      checked={config.enabled}
                      disabled={!ready || busy}
                      onChange={(enabled) => setConfig({ ...config, enabled })}
                    />
                  ),
                },
                {
                  label: t('conversation.mode'),
                  desc: t('conversation.videoDescription'),
                  children: (
                    <Select
                      value={config.mode}
                      options={[
                        { label: t('conversation.voiceMode'), value: 'voice' },
                        { label: t('conversation.videoMode'), value: 'video' },
                      ]}
                      onChange={(mode: 'voice' | 'video') => setConfig({ ...config, mode })}
                    />
                  ),
                },
                {
                  label: t('conversation.speechInput'),
                  desc: t('conversation.speechInputDescription'),
                  children: <Link to="/settings/service-model">{t('tab.serviceModel')}</Link>,
                },
                {
                  label: t('conversation.tts'),
                  children: (
                    <Select
                      showSearch
                      placeholder={t('conversation.modelPlaceholder')}
                      options={(providers ?? [])
                        .map((provider) => ({
                          label: provider.name || provider.id,
                          options: (models ?? [])
                            .filter((m) => m.type === 'tts' && m.providerId === provider.id)
                            .map((m) => ({
                              label: m.displayName || m.id,
                              value: `${provider.id}/${m.id}`,
                            })),
                        }))
                        .filter((p) => p.options.length > 0)}
                      value={
                        config.tts.model ? `${config.tts.provider}/${config.tts.model}` : undefined
                      }
                      onChange={(value: string) => {
                        const [provider, ...model] = value.split('/');
                        setConfig({
                          ...config,
                          tts: { provider, model: model.join('/') },
                          voice: '',
                        });
                      }}
                    />
                  ),
                },
                {
                  label: t('conversation.voice'),
                  children: (
                    <TTSVoiceSelect
                      value={config.voice || undefined}
                      voices={selectedModel?.voices}
                      defaultVoice={
                        (selectedModel?.parameters as { voice?: { default?: string } } | undefined)
                          ?.voice?.default
                      }
                      onChange={(voice) => setConfig({ ...config, voice: voice ?? '' })}
                    />
                  ),
                },
                {
                  label: t('conversation.language'),
                  children: (
                    <Input
                      placeholder="en"
                      value={config.language}
                      onChange={(e) => setConfig({ ...config, language: e.target.value })}
                    />
                  ),
                },
                {
                  label: t('conversation.silence'),
                  children: (
                    <Input
                      max={3000}
                      min={300}
                      step={100}
                      type="number"
                      value={String(config.silenceMs)}
                      onChange={(e) => setConfig({ ...config, silenceMs: Number(e.target.value) })}
                    />
                  ),
                },
              ],
            },
          ]}
        />
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!ready || busy}
            loading={busy}
            type="primary"
            onClick={() => void save(false)}
          >
            {t('conversation.save')}
          </Button>
          <Button disabled={!ready || busy} onClick={() => void save(true)}>
            {t('conversation.test')}
          </Button>
          <Link to="/settings/provider/all">{t('conversation.configureModels')}</Link>
        </Flexbox>
        {feedback && (
          <Alert
            title={t(`conversation.${feedback}`)}
            type={feedback === 'error' ? 'error' : 'success'}
          />
        )}
        <Alert title={t('conversation.worker')} type="info" />
      </Flexbox>
    </>
  );
};
export default Page;
