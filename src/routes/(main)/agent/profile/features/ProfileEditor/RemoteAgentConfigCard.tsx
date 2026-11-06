'use client';

import {
  HETEROGENEOUS_TYPE_LABELS,
  type RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { HeterogeneousProviderConfig } from '@lobechat/types';
import {
  ActionIcon,
  Button as BaseButton,
  Button,
  createModal,
  Flexbox,
  Icon,
  Select,
  Tag,
  Text,
  Tooltip,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as i18nT } from 'i18next';
import { BotIcon, CheckCircle2, MonitorSmartphone, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  getBoundDevicePresence,
  getDeviceSelectState,
} from '@/features/HeterogeneousAgent/ExecutionEnvironment/boundDevicePresence';
import { deviceService } from '@/services/device';
import { useAgentStore } from '@/store/agent';
import { isDevicePresenceUnknown, useDeviceList } from '@/store/device';

const styles = stylex.create({
  card: {
    paddingBlockStart: '16px',
    paddingBlockEnd: '4px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  cardHeader: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlockEnd: '12px',
  },
  title: { fontSize: '14px', fontWeight: 500 },
  detailList: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  detailRow: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    minHeight: '44px',
    paddingBlock: '6px',
  },
  detailRowDivider: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  detailLabel: { flexShrink: 0, width: '96px', fontSize: '12px', color: cssVar.colorTextTertiary },
  detailContent: {
    display: 'flex',
    flex: '1',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
  },
  deviceItem: { display: 'flex', gap: '6px', alignItems: 'center' },
});

interface ChangeDeviceContentProps {
  currentDeviceId?: string;
  isWorkspaceAgent: boolean;
  onConfirm: (deviceId: string) => Promise<void> | void;
  platform: RemoteHeterogeneousAgentType;
}

const ChangeDeviceContent = memo<ChangeDeviceContentProps>(
  ({ currentDeviceId, isWorkspaceAgent, onConfirm, platform }) => {
    const { t } = useTranslation('setting');
    const { close, setCanDismissByClickOutside } = useModalContext();

    const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(currentDeviceId);
    const [capabilityResult, setCapabilityResult] = useState<
      { available: boolean; reason?: string; version?: string } | undefined
    >(undefined);
    const [checkingCapability, setCheckingCapability] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      setCanDismissByClickOutside(!saving);
    }, [saving, setCanDismissByClickOutside]);

    // The shared device replica (see useDeviceList), partitioned by workspace.
    const {
      data: devices,
      error: deviceListError,
      isConfirmed,
      isLoading: loadingDevices,
      isValidating: validatingDevices,
      mutate: refreshDevices,
    } = useDeviceList();
    // Only online devices are offered, and neither a stored row's presence nor
    // a stored copy's missing rows are known until the server confirms the list
    // — keep the picker loading until then.
    const selectState = getDeviceSelectState({
      error: deviceListError,
      hasUnknownPresence: (devices ?? []).some(isDevicePresenceUnknown),
      isConfirmed,
      isLoading: loadingDevices,
      isValidating: validatingDevices,
    });

    const onlineDevices = (devices ?? []).filter(
      (d) =>
        d.online && (!isWorkspaceAgent || (d.scope === 'workspace' && d.visibility === 'public')),
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
            loading={selectState === 'loading'}
            placeholder={t('platformAgentConfig.selectDevice')}
            style={{ width: '100%' }}
            value={selectedDeviceId}
            options={onlineDevices.map((d) => ({
              label: (
                <div {...stylex.props(styles.deviceItem)}>
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
          {selectState === 'error' && (
            <AsyncError
              error={deviceListError}
              variant={'inline'}
              onRetry={() => void refreshDevices()}
            />
          )}
          {checkingCapability && (
            <Tag style={{ marginInlineEnd: 0 }}>
              {t('platformAgentConfig.availability.checking')}
            </Tag>
          )}
          {capabilityOk && (
            <Flexbox horizontal align="center" gap={4}>
              <Icon color="var(--lobe-color-success)" icon={CheckCircle2} size={14} />
              <Tag color="success" style={{ marginInlineEnd: 0 }}>
                {capabilityResult?.version ?? t('platformAgentConfig.availability.available')}
              </Tag>
            </Flexbox>
          )}
          {capabilityBad && (
            <Flexbox horizontal align="center" gap={4}>
              <Icon color="var(--lobe-color-error)" icon={XCircle} size={14} />
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

    // The shared device replica — see the comment on the sibling call above.
    const { data: devices, isConfirmed } = useDeviceList();

    const boundDevice = devices?.find((d) => d.deviceId === boundDeviceId);
    const boundPresence = getBoundDevicePresence(boundDeviceId, boundDevice, isConfirmed);
    const boundPresenceUnknown = boundPresence === 'checking';

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
      if (boundPresenceUnknown) {
        return (
          <Tag style={{ marginInlineEnd: 0 }}>{t('platformAgentConfig.availability.checking')}</Tag>
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
            <Icon color="var(--lobe-color-success)" icon={CheckCircle2} size={14} />
            <Tag color="success" style={{ marginInlineEnd: 0 }}>
              {capabilityResult.version ?? t('platformAgentConfig.availability.available')}
            </Tag>
          </Flexbox>
        );
      }
      return (
        <Flexbox horizontal align="center" gap={4}>
          <Icon color="var(--lobe-color-error)" icon={XCircle} size={14} />
          <Tag color="error" style={{ marginInlineEnd: 0 }}>
            {t('platformAgentConfig.availability.notInstalled')}
          </Tag>
        </Flexbox>
      );
    };

    return (
      <Flexbox className={stylex.props(styles.card).className} gap={0}>
        <div {...stylex.props(styles.cardHeader)}>
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={MonitorSmartphone} size={16} />
            <Text strong className={stylex.props(styles.title).className}>
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
        <div {...stylex.props(styles.detailList)}>
          <div {...stylex.props(styles.detailRow)}>
            <Text className={stylex.props(styles.detailLabel).className}>
              {t('platformAgentConfig.platform.label')}
            </Text>
            <div {...stylex.props(styles.detailContent)}>
              <Tag style={{ marginInlineEnd: 0 }}>{platformName}</Tag>
            </div>
          </div>
          <div {...stylex.props(styles.detailRow, styles.detailRowDivider)}>
            <Text className={stylex.props(styles.detailLabel).className}>
              {t('platformAgentConfig.device.label')}
            </Text>
            <div {...stylex.props(styles.detailContent)}>
              {boundDevice ? (
                <Flexbox horizontal align="center" gap={6}>
                  <Text ellipsis style={{ fontSize: 14 }}>
                    {boundDevice.hostname}
                  </Text>
                  <Tag
                    color={boundDevice.online ? 'success' : 'default'}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {boundPresenceUnknown
                      ? t('devices.status.checking')
                      : boundDevice.online
                        ? t('platformAgentConfig.device.online')
                        : t('platformAgentConfig.device.offline')}
                  </Tag>
                </Flexbox>
              ) : (
                <Tag style={{ marginInlineEnd: 0 }}>
                  {boundPresenceUnknown
                    ? t('devices.status.checking')
                    : t('platformAgentConfig.device.none')}
                </Tag>
              )}
            </div>
          </div>
          <div {...stylex.props(styles.detailRow, styles.detailRowDivider)}>
            <Text className={stylex.props(styles.detailLabel).className}>
              {t('platformAgentConfig.availability.label')}
            </Text>
            <div {...stylex.props(styles.detailContent)}>{renderAvailability()}</div>
          </div>
          <div {...stylex.props(styles.detailRow, styles.detailRowDivider)}>
            <div {...stylex.props(styles.detailLabel)} />
            <div {...stylex.props(styles.detailContent)}>
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
