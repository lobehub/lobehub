'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { App, Button, Empty, Input, Popconfirm, Select, Switch, Typography } from 'antd';
import { PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { agentBotProviderService } from '@/services/agentBotProvider';

const { Title, Text } = Typography;

const PLATFORM_OPTIONS = [
  { label: 'Discord', value: 'discord' },
  { label: 'Slack', value: 'slack' },
];

interface AddFormState {
  applicationId: string;
  botToken: string;
  platform: string;
  publicKey: string;
}

const INITIAL_FORM: AddFormState = {
  applicationId: '',
  botToken: '',
  platform: 'discord',
  publicKey: '',
};

const IntegrationPage = memo(() => {
  const { t } = useTranslation('setting');
  const { aid } = useParams<{ aid?: string }>();
  const { message: msg } = App.useApp();

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AddFormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  const {
    data: providers,
    isLoading,
    mutate,
  } = useSWR(aid ? ['agentBotProviders', aid] : null, () =>
    agentBotProviderService.getByAgentId(aid!),
  );

  const handleAdd = useCallback(async () => {
    if (!aid) return;
    if (!form.applicationId || !form.botToken || !form.publicKey || !form.platform) {
      msg.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      await agentBotProviderService.create({
        agentId: aid,
        applicationId: form.applicationId,
        credentials: {
          botToken: form.botToken,
          publicKey: form.publicKey,
        },
        platform: form.platform,
      });
      await mutate();
      setForm(INITIAL_FORM);
      setAdding(false);
      msg.success(t('settingBotProvider.createSuccess'));
    } catch {
      msg.error('Failed to create bot provider');
    } finally {
      setSaving(false);
    }
  }, [aid, form, msg, mutate, t]);

  const handleDelete = useCallback(
    async (id: string) => {
      await agentBotProviderService.delete(id);
      await mutate();
    },
    [mutate],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      await agentBotProviderService.update(id, { enabled });
      await mutate();
    },
    [mutate],
  );

  const [startingId, setStartingId] = useState<string | null>(null);
  const handleConnectBot = useCallback(
    async (applicationId: string, platform: string) => {
      setStartingId(applicationId);
      try {
        await agentBotProviderService.connectBot({ applicationId, platform });
        msg.success(t('settingBotProvider.connectSuccess'));
      } catch {
        msg.error(t('settingBotProvider.connectFailed'));
      } finally {
        setStartingId(null);
      }
    },
    [msg, t],
  );

  if (!aid) return null;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        <WideScreenContainer paddingBlock={16}>
          {isLoading && <Loading debugId="IntegrationPage" />}
          {!isLoading && (
            <Flexbox gap={24}>
              <Flexbox gap={8}>
                <Title level={4} style={{ margin: 0 }}>
                  {t('settingBotProvider.title')}
                </Title>
                <Text type="secondary">{t('settingBotProvider.description')}</Text>
              </Flexbox>

              {/* Existing providers list */}
              {providers && providers.length > 0 ? (
                <Flexbox gap={12}>
                  {providers.map((provider) => (
                    <Flexbox
                      horizontal
                      align="center"
                      gap={12}
                      justify="space-between"
                      key={provider.id}
                      style={{
                        border: '1px solid var(--lobe-color-border)',
                        borderRadius: 8,
                        padding: '12px 16px',
                      }}
                    >
                      <Flexbox gap={4}>
                        <Text strong style={{ textTransform: 'capitalize' }}>
                          {provider.platform}
                        </Text>
                        <Text type="secondary">
                          {t('settingBotProvider.applicationId')}: {provider.applicationId}
                        </Text>
                      </Flexbox>
                      <Flexbox horizontal align="center" gap={8}>
                        <Button
                          icon={<PlayIcon size={14} />}
                          loading={startingId === provider.applicationId}
                          size="small"
                          onClick={() =>
                            handleConnectBot(provider.applicationId, provider.platform)
                          }
                        >
                          {t('settingBotProvider.connect')}
                        </Button>
                        <Switch
                          checked={provider.enabled}
                          size="small"
                          onChange={(checked) => handleToggle(provider.id, checked)}
                        />
                        <Popconfirm
                          okButtonProps={{ danger: true }}
                          title={t('settingBotProvider.deleteConfirm')}
                          onConfirm={() => handleDelete(provider.id)}
                        >
                          <ActionIcon icon={Trash2Icon} size="small" />
                        </Popconfirm>
                      </Flexbox>
                    </Flexbox>
                  ))}
                </Flexbox>
              ) : (
                !adding && (
                  <Empty
                    description={t('settingBotProvider.empty')}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )
              )}

              {/* Add form */}
              {adding && (
                <Flexbox
                  gap={16}
                  style={{
                    border: '1px solid var(--lobe-color-border)',
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <Flexbox gap={12}>
                    <Flexbox gap={4}>
                      <Text>{t('settingBotProvider.platform')}</Text>
                      <Select
                        options={PLATFORM_OPTIONS}
                        value={form.platform}
                        onChange={(value) => setForm((prev) => ({ ...prev, platform: value }))}
                      />
                    </Flexbox>
                    <Flexbox gap={4}>
                      <Text>{t('settingBotProvider.applicationId')}</Text>
                      <Input
                        placeholder={t('settingBotProvider.applicationId')}
                        value={form.applicationId}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, applicationId: e.target.value }))
                        }
                      />
                    </Flexbox>
                    <Flexbox gap={4}>
                      <Text>{t('settingBotProvider.botToken')}</Text>
                      <Input.Password
                        placeholder={t('settingBotProvider.botToken')}
                        value={form.botToken}
                        onChange={(e) => setForm((prev) => ({ ...prev, botToken: e.target.value }))}
                      />
                    </Flexbox>
                    <Flexbox gap={4}>
                      <Text>{t('settingBotProvider.publicKey')}</Text>
                      <Input
                        placeholder={t('settingBotProvider.publicKey')}
                        value={form.publicKey}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, publicKey: e.target.value }))
                        }
                      />
                    </Flexbox>
                  </Flexbox>
                  <Flexbox horizontal gap={8} justify="flex-end">
                    <Button
                      onClick={() => {
                        setAdding(false);
                        setForm(INITIAL_FORM);
                      }}
                    >
                      {t('cancel', { ns: 'common' })}
                    </Button>
                    <Button loading={saving} type="primary" onClick={handleAdd}>
                      {t('ok', { ns: 'common' })}
                    </Button>
                  </Flexbox>
                </Flexbox>
              )}

              {/* Add button */}
              {!adding && (
                <Button
                  block
                  icon={<PlusIcon size={14} />}
                  type="dashed"
                  onClick={() => setAdding(true)}
                >
                  {t('settingBotProvider.add')}
                </Button>
              )}
            </Flexbox>
          )}
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
});

export default IntegrationPage;
