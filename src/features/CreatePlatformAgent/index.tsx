'use client';

import {
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
  type RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import { Button, Flexbox, Icon } from '@lobehub/ui';
import {
  Button as BaseButton,
  createModal,
  type ModalInstance,
  Select,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { Alert, Input, Steps, Tag, Typography } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { t as i18nT } from 'i18next';
import {
  BotIcon,
  CheckCircle2,
  Download,
  MonitorSmartphone,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { lambdaQuery } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css }) => ({
  avatarPreview: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    border-radius: ${cssVar.borderRadiusLG};

    font-size: 28px;
    line-height: 1;

    background: ${cssVar.colorFillSecondary};
  `,
  deviceItem: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  platformCard: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.2s;

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }

    &[data-selected='true'] {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBg};
    }

    &[data-disabled='true'] {
      cursor: not-allowed;
      opacity: 0.5;

      &:hover {
        border-color: ${cssVar.colorBorderSecondary};
      }
    }
  `,
  platformDesc: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  platformName: css`
    font-size: 15px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface AgentProfile {
  avatar?: string;
  description?: string;
  title?: string;
}

interface CreatePlatformAgentContentProps {
  groupId?: string;
  visibility?: 'private' | 'public';
}

const COMING_SOON_PLATFORMS = new Set<RemoteHeterogeneousAgentType>(['amp', 'opencode']);

const CreatePlatformAgentContent = memo<CreatePlatformAgentContentProps>(
  ({ groupId, visibility }) => {
    const { t } = useTranslation('chat');
    const { close, setCanDismissByClickOutside } = useModalContext();
    const navigate = useNavigate();
    const storeCreateAgent = useAgentStore((s) => s.createAgent);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

    // Creating from a workspace context: the new agent inherits the active
    // workspace's scope (server-side), so the device picker must restrict to
    // workspace devices — a workspace agent bound to a personal device is
    // unreachable to other members and the server rejects the write.
    const activeWorkspaceId = useActiveWorkspaceId();
    const restrictToWorkspaceDevices = Boolean(activeWorkspaceId);

    const [step, setStep] = useState(0);
    const [platform, setPlatform] = useState<RemoteHeterogeneousAgentType>('openclaw');
    const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
    const [agentName, setAgentName] = useState('');
    const [agentDescription, setAgentDescription] = useState('');
    const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
    const [fetchingProfile, setFetchingProfile] = useState(false);
    const [creating, setCreating] = useState(false);
    useEffect(() => {
      setCanDismissByClickOutside(!creating);
    }, [creating, setCanDismissByClickOutside]);
    const [capabilityResult, setCapabilityResult] = useState<
      { available: boolean; reason?: string; version?: string } | undefined
    >(undefined);
    const [checkingCapability, setCheckingCapability] = useState(false);

    const platformDefs = REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((c) => ({
      comingSoon: COMING_SOON_PLATFORMS.has(c.type),
      desc: t(`platformAgent.create.desc.${c.type}`),
      name: c.title,
      type: c.type,
    }));

    const {
      data: devices,
      isLoading: loadingDevices,
      isFetching: fetchingDevices,
      refetch: refetchDevices,
    } = lambdaQuery.device.listDevices.useQuery(undefined, {
      staleTime: 0,
    });

    const selectedPlatformDef = platformDefs.find((p) => p.type === platform)!;

    useEffect(() => {
      if (step !== 2) return;
      if (agentProfile !== null) {
        if (!agentName) setAgentName(agentProfile.title ?? selectedPlatformDef.name);
        if (!agentDescription) setAgentDescription(agentProfile.description ?? '');
      } else if (!fetchingProfile && !agentName) {
        setAgentName(selectedPlatformDef.name);
      }
    }, [step, agentProfile, fetchingProfile]);

    const handlePlatformChange = useCallback((type: RemoteHeterogeneousAgentType) => {
      setPlatform(type);
      // Reset device + capability state — capability is platform-specific;
      // stale results from the previous platform must not carry over.
      setDeviceId(undefined);
      setCapabilityResult(undefined);
      setAgentProfile(null);
    }, []);

    const checkCapability = useCallback(
      async (dId: string) => {
        setCheckingCapability(true);
        setCapabilityResult(undefined);
        try {
          const result = await deviceService.checkCapability({
            deviceId: dId,
            platform,
          });
          setCapabilityResult(result);
        } catch {
          setCapabilityResult({ available: false, reason: t('platformAgent.create.checkFailed') });
        } finally {
          setCheckingCapability(false);
        }
      },
      [platform, t],
    );

    const fetchProfile = useCallback(
      async (dId: string) => {
        setFetchingProfile(true);
        setAgentProfile(null);
        try {
          const profile = await deviceService.getAgentProfile({
            deviceId: dId,
            platform,
          });
          setAgentProfile(profile);
        } catch {
          setAgentProfile({});
        } finally {
          setFetchingProfile(false);
        }
      },
      [platform],
    );

    const handleDeviceChange = useCallback(
      (dId: string) => {
        setDeviceId(dId);
        void checkCapability(dId);
        void fetchProfile(dId);
      },
      [checkCapability, fetchProfile],
    );

    const handleNext = useCallback(() => {
      setStep((s) => s + 1);
    }, []);

    const handleBack = useCallback(() => {
      setStep((s) => s - 1);
    }, []);

    const handleCreate = useCallback(async () => {
      if (!deviceId) return;
      setCreating(true);
      try {
        const title = agentName.trim() || selectedPlatformDef.name;
        const result = await storeCreateAgent({
          config: {
            agencyConfig: {
              boundDeviceId: deviceId,
              heterogeneousProvider: {
                type: platform,
              },
            },
            avatar: agentProfile?.avatar || undefined,
            description: agentDescription.trim() || undefined,
            title,
          },
          groupId,
          visibility,
        });
        await refreshAgentList();
        close();
        navigate(`/agent/${result.agentId}`);
      } finally {
        setCreating(false);
      }
    }, [
      deviceId,
      agentName,
      agentDescription,
      agentProfile,
      platform,
      groupId,
      visibility,
      storeCreateAgent,
      refreshAgentList,
      close,
      navigate,
      selectedPlatformDef.name,
    ]);

    const renderCapabilityStatus = () => {
      if (!deviceId) return null;
      if (checkingCapability)
        return <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgent.create.checking')}</Tag>;
      if (!capabilityResult) return null;
      if (capabilityResult.available) {
        return (
          <Flexbox horizontal align="flex-start" gap={4} style={{ flexWrap: 'wrap' }}>
            <Icon
              color="var(--ant-color-success)"
              icon={CheckCircle2}
              size={14}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <Tag
              color="success"
              style={{ marginInlineEnd: 0, whiteSpace: 'normal', wordBreak: 'break-word' }}
            >
              {capabilityResult.version ?? t('platformAgent.create.available')}
            </Tag>
          </Flexbox>
        );
      }

      const isVersionTooLow = capabilityResult.reason?.includes('is not available on this device');
      if (isVersionTooLow) {
        return (
          <Alert
            showIcon
            message={t('platformAgent.create.versionTooLow')}
            type="warning"
            description={
              <Flexbox gap={4}>
                <span>{t('platformAgent.create.versionTooLowHint')}</span>
                <Typography.Text code copyable>
                  {t('platformAgent.create.upgradeCmd')}
                </Typography.Text>
              </Flexbox>
            }
          />
        );
      }

      return (
        <Flexbox horizontal align="center" gap={4}>
          <Icon color="var(--ant-color-error)" icon={XCircle} size={14} />
          <Tag color="error" style={{ marginInlineEnd: 0 }}>
            {capabilityResult.reason ??
              t('platformAgent.create.notInstalled', { name: selectedPlatformDef.name })}
          </Tag>
        </Flexbox>
      );
    };

    const step2NextDisabled =
      !deviceId || checkingCapability || capabilityResult?.available === false;

    const renderStepContent = () => {
      if (step === 0) {
        return (
          <Flexbox gap={12}>
            {platformDefs.map((def) => (
              <div
                className={styles.platformCard}
                data-disabled={def.comingSoon}
                data-selected={!def.comingSoon && platform === def.type}
                key={def.type}
                role="button"
                tabIndex={def.comingSoon ? -1 : 0}
                onClick={() => !def.comingSoon && handlePlatformChange(def.type)}
                onKeyDown={(e) => {
                  if (!def.comingSoon && (e.key === 'Enter' || e.key === ' '))
                    handlePlatformChange(def.type);
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <Icon icon={MonitorSmartphone} size={18} />
                  <span className={styles.platformName}>{def.name}</span>
                  {def.comingSoon && (
                    <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgent.create.comingSoon')}</Tag>
                  )}
                </Flexbox>
                <span className={styles.platformDesc}>{def.desc}</span>
              </div>
            ))}
          </Flexbox>
        );
      }

      if (step === 1) {
        const onlineDevices = (devices ?? []).filter(
          (d) => d.online && (!restrictToWorkspaceDevices || d.scope === 'workspace'),
        );
        const isRefreshing = loadingDevices || fetchingDevices;

        const refreshButton = (
          <Button
            icon={<Icon icon={RefreshCw} size={13} />}
            loading={isRefreshing}
            size="small"
            type="text"
            onClick={() => void refetchDevices()}
          >
            {t('platformAgent.create.refresh')}
          </Button>
        );

        if (!isRefreshing && onlineDevices.length === 0) {
          return (
            <Flexbox gap={12}>
              <Alert
                showIcon
                message={t('platformAgent.create.noDevices')}
                type="info"
                description={
                  <Flexbox gap={12}>
                    <Flexbox gap={6}>
                      <span>{t('platformAgent.create.noDevicesDesktopHint')}</span>
                      <a href="https://lobehub.com/downloads" rel="noreferrer" target="_blank">
                        <Button
                          icon={<Icon icon={Download} size={13} />}
                          size="small"
                          type="primary"
                        >
                          {t('platformAgent.create.downloadDesktop')}
                        </Button>
                      </a>
                    </Flexbox>
                    <Flexbox gap={4}>
                      <span>{t('platformAgent.create.noDevicesCliHint')}</span>
                      <Typography.Text code copyable>
                        {t('platformAgent.create.noDevicesCmd')}
                      </Typography.Text>
                    </Flexbox>
                  </Flexbox>
                }
              />
              {refreshButton}
            </Flexbox>
          );
        }

        return (
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" gap={8}>
              <Select
                loading={isRefreshing}
                placeholder={t('platformAgent.create.selectDevice')}
                style={{ flex: 1 }}
                value={deviceId}
                options={onlineDevices.map((d) => ({
                  label: (
                    <div className={styles.deviceItem}>
                      <Icon icon={BotIcon} size={14} />
                      <span>{d.hostname}</span>
                      <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        {t('platformAgent.device.online')}
                      </Tag>
                    </div>
                  ),
                  value: d.deviceId,
                }))}
                onChange={handleDeviceChange}
              />
              {refreshButton}
            </Flexbox>
            {renderCapabilityStatus()}
          </Flexbox>
        );
      }

      if (step === 2) {
        const avatar = agentProfile?.avatar;
        return (
          <Flexbox gap={12}>
            {avatar && (
              <Flexbox horizontal align="center" gap={12}>
                <div className={styles.avatarPreview}>{avatar}</div>
              </Flexbox>
            )}
            <Input
              maxLength={60}
              value={agentName}
              placeholder={
                fetchingProfile
                  ? t('platformAgent.create.fetchingProfile')
                  : t('platformAgent.create.namePlaceholder')
              }
              onChange={(e) => setAgentName(e.target.value)}
              onPressEnter={() => void handleCreate()}
            />
            <Input.TextArea
              autoSize={{ maxRows: 4, minRows: 2 }}
              maxLength={200}
              placeholder={t('platformAgent.create.descriptionPlaceholder')}
              value={agentDescription}
              onChange={(e) => setAgentDescription(e.target.value)}
            />
          </Flexbox>
        );
      }

      return null;
    };

    const renderFooter = () => {
      const buttons = [];

      if (step > 0) {
        buttons.push(
          <BaseButton key="back" onClick={handleBack}>
            {t('platformAgent.create.back')}
          </BaseButton>,
        );
      }

      if (step < 2) {
        const nextDisabled = step === 1 && step2NextDisabled;
        buttons.push(
          <BaseButton disabled={nextDisabled} key="next" type="primary" onClick={handleNext}>
            {t('platformAgent.create.next')}
          </BaseButton>,
        );
      }

      if (step === 2) {
        buttons.push(
          <BaseButton
            disabled={!agentName.trim() && !selectedPlatformDef.name}
            key="create"
            loading={creating}
            type="primary"
            onClick={() => void handleCreate()}
          >
            {creating ? t('platformAgent.create.creating') : t('platformAgent.create.create')}
          </BaseButton>,
        );
      }

      return buttons;
    };

    return (
      <Flexbox gap={24} paddingBlock={'16px 8px'}>
        <Steps
          current={step}
          size="small"
          items={[
            { title: t('platformAgent.create.step1') },
            { title: t('platformAgent.create.step2') },
            { title: t('platformAgent.create.step3') },
          ]}
        />
        {renderStepContent()}
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          {renderFooter()}
        </Flexbox>
      </Flexbox>
    );
  },
);

CreatePlatformAgentContent.displayName = 'CreatePlatformAgentContent';

interface OpenCreatePlatformAgentModalOptions {
  groupId?: string;
  visibility?: 'private' | 'public';
}

export const openCreatePlatformAgentModal = (
  options?: OpenCreatePlatformAgentModalOptions,
): ModalInstance =>
  createModal({
    content: (
      <CreatePlatformAgentContent groupId={options?.groupId} visibility={options?.visibility} />
    ),
    footer: null,
    maskClosable: true,
    title: i18nT('platformAgent.create.title', { ns: 'chat' }),
    width: 480,
  });
