'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  type RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { Button as BaseButton, createModal, Select, useModalContext } from '@lobehub/ui/base-ui';
import { Button, Tag } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { t as i18nT } from 'i18next';
import { BotIcon, CheckCircle2, MonitorSmartphone, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { deviceService } from '@/services/device';
import { useAgentStore } from '@/store/agent';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 16px 4px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  cardHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block-end: 12px;
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
  `,
  detailList: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  detailRow: css`
    display: flex;
    gap: 16px;
    align-items: center;

    min-height: 44px;
    padding-block: 6px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  detailLabel: css`
    flex-shrink: 0;

    width: 96px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  detailContent: css`
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  deviceItem: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
}));

interface ChangeDeviceContentProps {
  currentDeviceId?: string;
  isWorkspaceAgent: boolean;
  onConfirm: (deviceId: string) => Promise<void> | void;
  platform: RemoteHeterogeneousAgentType;
}

const ChangeDeviceContent = memo<ChangeDeviceContentProps>(
  ({ currentDeviceId, isWorkspaceAgent, onConfirm, platform }) => {
    const { t } = useTranslation('setting');
    const { close } = useModalContext();

    const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(currentDeviceId);
    const [capabilityResult, setCapabilityResult] = useState<
      { available: boolean; reason?: string; version?: string } | undefined
    >(undefined);
    const [checkingCapability, setCheckingCapability] = useState(false);
    const [saving, setSaving] = useState(false);

    const { data: devices, isLoading: loadingDevices } = lambdaQuery.device.listDevices.useQuery(
      undefined,
      { staleTime: 30_000 },
    );

    const onlineDevices = (devices ?? []).filter(
      (d) => d.online && (!isWorkspaceAgent || d.scope === 'workspace'),
    );

    const checkCapability = useCallback(
      async (deviceId: string) => {
        setCheckingCapability(true);
        setCapabilityResult(undefined);
        try {
          const result = await deviceService.checkCapability({
            deviceId,
            platform,
          });
          setCapabilityResult(result);
        } catch {
          setCapabilityResult({ available: false, reason: 'Check failed' });
        } finally {
          setCheckingCapability(false);
        }
      },
      [platform],
    );

    const handleDeviceSelect = useCallback(
      (dId: string) => {
        setSelectedDeviceId(dId);
        void checkCapability(dId);
      },
      [checkCapability],
    );

    const handleSave = async () => {
      if (!selectedDeviceId) return;
      setSaving(true);
      try {
        await onConfirm(selectedDeviceId);
        close();
      } finally {
        setSaving(false);
      }
    };

    const capabilityOk = capabilityResult?.available === true;
    const capabilityBad = capabilityResult?.available === false;

    return (
      <Flexbox gap={16}>
        <Flexbox gap={12} paddingBlock={'12px 4px'}>
          <Select
            loading={loadingDevices}
            placeholder={t('platformAgentConfig.selectDevice')}
            style={{ width: '100%' }}
            value={selectedDeviceId}
            options={onlineDevices.map((d) => ({
              label: (
                <div className={styles.deviceItem}>
                  <Icon icon={BotIcon} size={14} />
                  <span>{d.hostname}</span>
                  <Tag color="success" style={{ marginInlineEnd: 0 }}>
                    {t('platformAgentConfig.device.online')}
                  </Tag>
                </div>
              ),
              value: d.deviceId,
            }))}
            onChange={handleDeviceSelect}
          />
          {checkingCapability && (
            <Tag style={{ marginInlineEnd: 0 }}>
              {t('platformAgentConfig.availability.checking')}
            </Tag>
          )}
          {capabilityOk && (
            <Flexbox horizontal align="center" gap={4}>
              <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={14} />
              <Tag color="success" style={{ marginInlineEnd: 0 }}>
                {capabilityResult?.version ?? t('platformAgentConfig.availability.available')}
              </Tag>
            </Flexbox>
          )}
          {capabilityBad && (
            <Flexbox horizontal align="center" gap={4}>
              <Icon color="var(--ant-color-error)" icon={XCircle} size={14} />
              <Tag color="error" style={{ marginInlineEnd: 0 }}>
                {t('platformAgentConfig.availability.notInstalled')}
              </Tag>
            </Flexbox>
          )}
        </Flexbox>
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <BaseButton disabled={saving} onClick={close}>
            {t('cancel', { ns: 'common' })}
          </BaseButton>
          <BaseButton
            disabled={!selectedDeviceId || checkingCapability || capabilityBad}
            loading={saving}
            type={'primary'}
            onClick={handleSave}
          >
            {t('platformAgentConfig.changeDevice')}
          </BaseButton>
        </Flexbox>
      </Flexbox>
    );
  },
);

ChangeDeviceContent.displayName = 'ChangeDeviceContent';

interface OpenChangeDeviceModalOptions {
  currentDeviceId?: string;
  isWorkspaceAgent: boolean;
  onConfirm: (deviceId: string) => Promise<void> | void;
  platform: RemoteHeterogeneousAgentType;
}

const openChangeDeviceModal = (options: OpenChangeDeviceModalOptions) =>
  createModal({
    content: (
      <ChangeDeviceContent
        currentDeviceId={options.currentDeviceId}
        isWorkspaceAgent={options.isWorkspaceAgent}
        platform={options.platform}
        onConfirm={options.onConfirm}
      />
    ),
    footer: null,
    maskClosable: true,
    title: i18nT('platformAgentConfig.changeDevice', { ns: 'setting' }),
    width: 400,
  });

interface RemoteAgentConfigCardProps {
  onBoundDeviceChange?: (deviceId: string) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

const RemoteAgentConfigCard = memo<RemoteAgentConfigCardProps>(
  ({ provider, onBoundDeviceChange }) => {
    const { t } = useTranslation('setting');

    const agentId = useAgentStore((s) => s.activeAgentId);
    const boundDeviceId = useAgentStore((s) =>
      agentId ? s.agentMap[agentId]?.agencyConfig?.boundDeviceId : undefined,
    );
    // Workspace-scoped agents are reachable by every workspace member, but a
    // personal device is only reachable by its owner. Hide personal devices
    // from the picker so workspace agents can only bind workspace devices.
    const agentWorkspaceId = useAgentStore((s) =>
      agentId ? s.agentMap[agentId]?.workspaceId : undefined,
    );
    const isWorkspaceAgent = Boolean(agentWorkspaceId);

    const [capabilityResult, setCapabilityResult] = useState<
      { available: boolean; reason?: string; version?: string } | undefined
    >(undefined);
    const [checkingCapability, setCheckingCapability] = useState(false);

    const platformName = HETEROGENEOUS_TYPE_LABELS[provider.type] ?? provider.type;

    const { data: devices } = lambdaQuery.device.listDevices.useQuery(undefined, {
      staleTime: 30_000,
    });

    const boundDevice = devices?.find((d) => d.deviceId === boundDeviceId);

    const checkCapability = useCallback(
      async (deviceId: string) => {
        setCheckingCapability(true);
        setCapabilityResult(undefined);
        try {
          const result = await deviceService.checkCapability({
            deviceId,
            platform: provider.type as RemoteHeterogeneousAgentType,
          });
          setCapabilityResult(result);
        } catch {
          setCapabilityResult({ available: false, reason: 'Check failed' });
        } finally {
          setCheckingCapability(false);
        }
      },
      [provider.type],
    );

    useEffect(() => {
      if (boundDeviceId && boundDevice?.online) {
        void checkCapability(boundDeviceId);
      }
    }, [boundDeviceId, boundDevice?.online, checkCapability]);

    const handleOpenChangeDevice = useCallback(() => {
      openChangeDeviceModal({
        currentDeviceId: boundDeviceId,
        isWorkspaceAgent,
        onConfirm: async (deviceId) => {
          await onBoundDeviceChange?.(deviceId);
        },
        platform: provider.type as RemoteHeterogeneousAgentType,
      });
    }, [boundDeviceId, isWorkspaceAgent, onBoundDeviceChange, provider.type]);

    const renderAvailability = () => {
      if (!boundDeviceId) {
        return (
          <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgentConfig.availability.noDevice')}</Tag>
        );
      }
      if (!boundDevice?.online) {
        return (
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>
            {t('platformAgentConfig.device.offline')}
          </Tag>
        );
      }
      if (checkingCapability) {
        return (
          <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgentConfig.availability.checking')}</Tag>
        );
      }
      if (!capabilityResult) return null;
      if (capabilityResult.available) {
        return (
          <Flexbox horizontal align="center" gap={4}>
            <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={14} />
            <Tag color="success" style={{ marginInlineEnd: 0 }}>
              {capabilityResult.version ?? t('platformAgentConfig.availability.available')}
            </Tag>
          </Flexbox>
        );
      }
      return (
        <Flexbox horizontal align="center" gap={4}>
          <Icon color="var(--ant-color-error)" icon={XCircle} size={14} />
          <Tag color="error" style={{ marginInlineEnd: 0 }}>
            {t('platformAgentConfig.availability.notInstalled')}
          </Tag>
        </Flexbox>
      );
    };

    return (
      <Flexbox className={styles.card} gap={0}>
        <div className={styles.cardHeader}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={MonitorSmartphone} size={16} />
            <Text strong className={styles.title}>
              {t('platformAgentConfig.title')}
            </Text>
          </Flexbox>
          <Tooltip title={t('platformAgentConfig.redetect')}>
            <ActionIcon
              aria-label={t('platformAgentConfig.redetect')}
              disabled={!boundDeviceId || checkingCapability}
              icon={RefreshCw}
              loading={checkingCapability}
              size="small"
              onClick={() => boundDeviceId && void checkCapability(boundDeviceId)}
            />
          </Tooltip>
        </div>
        <div className={styles.detailList}>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('platformAgentConfig.platform.label')}</Text>
            <div className={styles.detailContent}>
              <Tag style={{ marginInlineEnd: 0 }}>{platformName}</Tag>
            </div>
          </div>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('platformAgentConfig.device.label')}</Text>
            <div className={styles.detailContent}>
              {boundDevice ? (
                <Flexbox horizontal align="center" gap={6}>
                  <Text ellipsis style={{ fontSize: 14 }}>
                    {boundDevice.hostname}
                  </Text>
                  <Tag
                    color={boundDevice.online ? 'success' : 'default'}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {boundDevice.online
                      ? t('platformAgentConfig.device.online')
                      : t('platformAgentConfig.device.offline')}
                  </Tag>
                </Flexbox>
              ) : (
                <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgentConfig.device.none')}</Tag>
              )}
            </div>
          </div>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>
              {t('platformAgentConfig.availability.label')}
            </Text>
            <div className={styles.detailContent}>{renderAvailability()}</div>
          </div>
          <div className={styles.detailRow}>
            <div className={styles.detailLabel} />
            <div className={styles.detailContent}>
              <Button size="small" onClick={handleOpenChangeDevice}>
                {t('platformAgentConfig.changeDevice')}
              </Button>
            </div>
          </div>
        </div>
      </Flexbox>
    );
  },
);

RemoteAgentConfigCard.displayName = 'RemoteAgentConfigCard';

export default RemoteAgentConfigCard;
