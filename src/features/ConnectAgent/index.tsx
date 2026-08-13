'use client';

import { isDesktop } from '@lobechat/const';
import type {
  HeterogeneousAgentScanStatus,
  HeterogeneousAgentType,
  RemoteHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import { isRemoteHeterogeneousType } from '@lobechat/heterogeneous-agents';
import type { DeviceListItem } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { Alert, CopyButton, Flexbox, Icon, Input, Text, TextArea, Tooltip } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  ScrollArea,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { Checkbox, Typography } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { t as i18nT } from 'i18next';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  LaptopIcon,
  RefreshCw,
  ScanSearch,
  TerminalIcon,
} from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { DOWNLOAD_URL } from '@/const/url';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { deviceService } from '@/services/device';
import { useAgentStore } from '@/store/agent';
import { useElectronStore } from '@/store/electron';
import { useHomeStore } from '@/store/home';

import type { ConnectableProvider, ConnectAgentProfile } from './providers';
import { buildConnectAgentConfig, CONNECTABLE_PROVIDERS } from './providers';
import type { ScanTarget } from './useAgentScan';
import { useAgentScan } from './useAgentScan';

const styles = createStaticStyles(({ css }) => ({
  agentListScrollbar: css`
    width: 2px;
    margin-block: 12px;
    margin-inline-end: 4px;
  `,
  agentListThumb: css`
    background: ${cssVar.colorFill};
  `,
  agentListViewport: css`
    overscroll-behavior: contain;
    max-height: min(50dvh, 400px);
  `,
  cmd: css`
    user-select: all;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;

    background: ${cssVar.colorFillTertiary};
  `,
  dot: css`
    flex: none;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,
  dotOff: css`
    flex: none;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  emptyCard: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  emptyHero: css`
    padding-block: 24px;
    padding-inline: 24px;
    text-align: center;
    background: ${cssVar.colorFillQuaternary};
  `,
  emptyOption: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;

    min-width: 0;
    min-height: 152px;
    padding: 18px;

    background: ${cssVar.colorBgContainer};
  `,
  emptyOptionAction: css`
    display: flex;
    align-items: center;

    width: 100%;
    min-height: 28px;
    margin-block-start: auto;

    > a {
      width: 100%;
    }
  `,
  emptyOptionCode: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    width: 100%;
    height: 32px;
    padding-inline: 10px 4px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};
  `,
  emptyOptions: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;

    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBorderSecondary};
  `,
  emptyOptionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  heroIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 52px;
    height: 52px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  groupList: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  iconBox: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;

    transition: background 0.15s;

    &:not(:last-child) {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  rowDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    &:hover {
      background: transparent;
    }
  `,
  rowStatic: css`
    cursor: default;

    &:hover {
      background: transparent;
    }
  `,
  skeletonBar: css`
    height: 10px;
    border-radius: 5px;
    background: ${cssVar.colorFillSecondary};
    animation: lobe-connect-agent-pulse 1.4s ease-in-out infinite;

    @keyframes lobe-connect-agent-pulse {
      50% {
        opacity: 0.45;
      }
    }
  `,
  skeletonCircle: css`
    flex: none;

    width: 32px;
    height: 32px;
    border-radius: 50%;

    background: ${cssVar.colorFillSecondary};

    animation: lobe-connect-agent-pulse 1.4s ease-in-out infinite;
  `,
}));

interface CreatedAgent {
  agentId: string;
  locationLabel: string;
  provider: ConnectableProvider;
  title: string;
  version?: string;
}

const SectionLabel = memo<{ children: ReactNode }>(({ children }) => (
  <Text fontSize={12} style={{ paddingInline: 4 }} type={'secondary'}>
    {children}
  </Text>
));

const SkeletonRow = memo<{ width: number }>(({ width }) => (
  <div className={`${styles.row} ${styles.rowStatic}`}>
    <div className={styles.skeletonCircle} />
    {/* Column height matches a real row's two-line text block so the
        scanning → done swap doesn't shift the modal */}
    <Flexbox flex={1} gap={10} justify={'center'} style={{ height: 42 }}>
      <div className={styles.skeletonBar} style={{ width }} />
      <div className={styles.skeletonBar} style={{ opacity: 0.6, width: width * 1.6 }} />
    </Flexbox>
  </div>
));

const ScrollableAgentList = memo<{ children: ReactNode }>(({ children }) => (
  <ScrollArea
    disableContentFit
    scrollFade
    className={styles.groupList}
    contentProps={{ style: { display: 'block' } }}
    scrollbarProps={{ className: styles.agentListScrollbar }}
    thumbProps={{ className: styles.agentListThumb }}
    viewportProps={{ className: styles.agentListViewport }}
  >
    {children}
  </ScrollArea>
));

ScrollableAgentList.displayName = 'ScrollableAgentList';

const DeviceRow = memo<{
  icon: ReactNode;
  offline?: boolean;
  onClick?: () => void;
  statusText: string;
  subtitle: string;
  title: string;
}>(({ icon, offline, onClick, statusText, subtitle, title }) => (
  <div
    className={offline ? `${styles.row} ${styles.rowDisabled}` : styles.row}
    role={'button'}
    tabIndex={offline ? -1 : 0}
    onClick={offline ? undefined : onClick}
  >
    <div className={styles.iconBox}>{icon}</div>
    <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
      <Text ellipsis strong>
        {title}
      </Text>
      <Text fontSize={12} type={'secondary'}>
        {subtitle}
      </Text>
    </Flexbox>
    <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
      <div className={offline ? styles.dotOff : styles.dot} />
      <Text fontSize={12} type={'secondary'}>
        {statusText}
      </Text>
    </Flexbox>
  </div>
));

const AgentScanRow = memo<{
  onToggle: () => void;
  provider: ConnectableProvider;
  selected: boolean;
  status?: HeterogeneousAgentScanStatus;
  subtitle: string;
  unavailableText: string;
}>(({ onToggle, provider, selected, status, subtitle, unavailableText }) => {
  const available = status?.available === true;
  const row = (
    <div
      className={available ? styles.row : `${styles.row} ${styles.rowDisabled}`}
      role={'button'}
      tabIndex={available ? 0 : -1}
      onClick={available ? onToggle : undefined}
    >
      <provider.brand.Avatar size={32} />
      <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
        <Text strong>{provider.title}</Text>
        <Text ellipsis fontSize={12} type={'secondary'}>
          {subtitle}
        </Text>
      </Flexbox>
      {available ? (
        <>
          {status?.version && <span className={styles.mono}>{status.version}</span>}
          <Checkbox checked={selected} style={{ pointerEvents: 'none' }} />
        </>
      ) : (
        <Text fontSize={12} type={'secondary'}>
          {unavailableText}
        </Text>
      )}
    </div>
  );

  if (!available && status?.reason) return <Tooltip title={status.reason}>{row}</Tooltip>;
  return row;
});

interface ConnectAgentContentProps {
  groupId?: string;
  onTitleChange: (title: string) => void;
  visibility?: 'private' | 'public';
}

const ConnectAgentContent = memo<ConnectAgentContentProps>(
  ({ groupId, onTitleChange, visibility }) => {
    const { t } = useTranslation('chat');
    const { close, setCanDismissByClickOutside } = useModalContext();
    const navigate = useWorkspaceAwareNavigate();
    const storeCreateAgent = useAgentStore((s) => s.createAgent);
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);

    // Workspace agents must bind workspace devices: a workspace agent on a
    // personal device is unreachable to other members and rejected server-side.
    const activeWorkspaceId = useActiveWorkspaceId();
    const restrictToWorkspaceDevices = Boolean(activeWorkspaceId);

    const [step, setStep] = useState(0);
    const [target, setTarget] = useState<ScanTarget | null>(null);
    const [selectedTypes, setSelectedTypes] = useState<HeterogeneousAgentType[]>([]);
    const [profiles, setProfiles] = useState<
      Partial<Record<RemoteHeterogeneousAgentType, ConnectAgentProfile>>
    >({});
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | undefined>();
    const [done, setDone] = useState<CreatedAgent[] | null>(null);

    const { scan, state: scanState } = useAgentScan();

    useEffect(() => {
      setCanDismissByClickOutside(!creating);
    }, [creating, setCanDismissByClickOutside]);

    const {
      data: devices,
      isLoading: loadingDevices,
      isValidating: fetchingDevices,
      mutate: refetchDevices,
    } = useDeviceList();

    const listedDevices = useMemo(
      () => (devices ?? []).filter((d) => !restrictToWorkspaceDevices || d.scope === 'workspace'),
      [devices, restrictToWorkspaceDevices],
    );
    const onlineDevices = listedDevices.filter((d) => d.online);

    const deviceLabel = useCallback(
      (device: DeviceListItem) => device.friendlyName || device.hostname || device.deviceId,
      [],
    );

    const targetLabel =
      target?.kind === 'device' ? deviceLabel(target.device) : t('connectAgent.create.localDevice');

    const inventory = useMemo(() => {
      if (scanState.status !== 'success' || !scanState.agents) return [];
      const rank = (available?: boolean) => (available ? 0 : 1);
      return [...CONNECTABLE_PROVIDERS]
        .map((provider) => ({ provider, status: scanState.agents?.[provider.type] }))
        .sort((a, b) => rank(a.status?.available) - rank(b.status?.available));
    }, [scanState]);

    const detectedCount = inventory.filter((entry) => entry.status?.available).length;

    const selectedProviders = useMemo(
      () => CONNECTABLE_PROVIDERS.filter((provider) => selectedTypes.includes(provider.type)),
      [selectedTypes],
    );
    // Customize (step 3) only applies to a single selection
    const single = selectedProviders.length === 1 ? selectedProviders[0] : null;
    const singleVersion = single ? scanState.agents?.[single.type]?.version : undefined;

    const pickTarget = useCallback(
      (next: ScanTarget) => {
        setTarget(next);
        setSelectedTypes([]);
        setProfiles({});
        setStep(1);
        void scan(next);
      },
      [scan],
    );

    const rescan = useCallback(() => {
      if (!target) return;
      setSelectedTypes([]);
      void scan(target);
    }, [scan, target]);

    const toggleType = useCallback(
      (provider: ConnectableProvider) => {
        setSelectedTypes((prev) =>
          prev.includes(provider.type)
            ? prev.filter((type) => type !== provider.type)
            : [...prev, provider.type],
        );
        // Prefetch the platform's profile so create/customize can prefill
        // title / description / avatar without an extra wait.
        if (
          provider.kind === 'platform' &&
          isRemoteHeterogeneousType(provider.type) &&
          !profiles[provider.type]
        ) {
          const deviceId = target?.kind === 'device' ? target.device.deviceId : currentDeviceId;
          if (!deviceId) return;
          const platform = provider.type;
          void deviceService
            .getAgentProfile({ deviceId, platform })
            .then((profile) => setProfiles((prev) => ({ ...prev, [platform]: profile })))
            .catch(() => {});
        }
      },
      [currentDeviceId, profiles, target],
    );

    const goConfirm = useCallback(() => {
      if (!single) return;
      const profile = isRemoteHeterogeneousType(single.type) ? profiles[single.type] : undefined;
      setName(profile?.title ?? single.title);
      setDescription(profile?.description ?? '');
      setStep(2);
    }, [profiles, single]);

    const buildCreateParams = useCallback(
      (provider: ConnectableProvider, overrides?: { description?: string; name?: string }) => {
        return {
          config: buildConnectAgentConfig({
            overrides,
            profile: isRemoteHeterogeneousType(provider.type) ? profiles[provider.type] : undefined,
            provider,
            target:
              target?.kind === 'device'
                ? { deviceId: target.device.deviceId, kind: 'device' }
                : { kind: 'local' },
          }),
          groupId,
          visibility,
        };
      },
      [groupId, profiles, target, visibility],
    );

    const handleCreate = useCallback(
      async (overrides?: { description?: string; name?: string }) => {
        if (!target || selectedProviders.length === 0) return;
        setCreating(true);
        setCreateError(undefined);
        try {
          const created = await Promise.all(
            selectedProviders.map(async (provider) => {
              const params = buildCreateParams(
                provider,
                provider === single ? overrides : undefined,
              );
              const result = await storeCreateAgent(params);
              return {
                agentId: result.agentId,
                locationLabel: targetLabel,
                provider,
                title: agentDisplayName(params.config, provider.title) ?? provider.title,
                version: scanState.agents?.[provider.type]?.version,
              } satisfies CreatedAgent;
            }),
          );
          await refreshAgentList();
          setDone(created);
          onTitleChange(
            created.length === 1
              ? t('connectAgent.create.doneTitle', { name: created[0].title })
              : t('connectAgent.create.doneTitleMany', { total: created.length }),
          );
        } catch (error) {
          setCreateError(error instanceof Error ? error.message : String(error));
        } finally {
          setCreating(false);
        }
      },
      [
        buildCreateParams,
        onTitleChange,
        refreshAgentList,
        scanState,
        selectedProviders,
        single,
        storeCreateAgent,
        t,
        target,
        targetLabel,
      ],
    );

    const openChat = useCallback(
      (agentId: string) => {
        close();
        navigate(`/agent/${agentId}`);
      },
      [close, navigate],
    );

    // ── Done: connected summary stays inside the modal ──
    if (done) {
      return (
        <Flexbox gap={8} paddingBlock={'16px 8px'}>
          <SectionLabel>{t('connectAgent.create.doneHint')}</SectionLabel>
          <div className={styles.groupList}>
            {done.map((agent) => (
              <div className={`${styles.row} ${styles.rowStatic}`} key={agent.agentId}>
                <agent.provider.brand.Avatar size={32} />
                <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
                  <Text strong fontSize={13}>
                    {agentDisplayName(agent)}
                  </Text>
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {agent.provider.title}
                    {agent.version ? ` ${agent.version}` : ''} · {agent.locationLabel}
                  </Text>
                </Flexbox>
                <div className={styles.dot} />
                <Button size={'small'} onClick={() => openChat(agent.agentId)}>
                  {t('connectAgent.create.openChat')}
                </Button>
              </div>
            ))}
          </div>
          <Flexbox horizontal justify={'flex-end'} style={{ paddingBlockStart: 8 }}>
            <Button type={'primary'} onClick={close}>
              {t('connectAgent.create.done')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    // ── Step 1: choose the machine ──
    if (step === 0) {
      const isRefreshing = loadingDevices || fetchingDevices;
      const showEmpty = !isDesktop && !isRefreshing && onlineDevices.length === 0;

      return (
        <Flexbox gap={16} paddingBlock={'16px 8px'}>
          <SectionLabel>{t('connectAgent.create.stepDevice')}</SectionLabel>
          {showEmpty ? (
            <div className={styles.emptyCard}>
              <Flexbox align={'center'} className={styles.emptyHero} gap={10}>
                <span className={styles.heroIcon}>
                  <Icon icon={LaptopIcon} size={26} />
                </span>
                <Text fontSize={17} weight={600}>
                  {t('connectAgent.create.noDevices')}
                </Text>
                <Text style={{ maxWidth: 400 }} type={'secondary'}>
                  {t('connectAgent.create.noDevicesDesc')}
                </Text>
              </Flexbox>
              <div className={styles.emptyOptions}>
                <div className={styles.emptyOption}>
                  <span className={styles.emptyOptionIcon}>
                    <Icon icon={Download} size={20} />
                  </span>
                  <Flexbox gap={3}>
                    <Text weight={500}>{t('connectAgent.create.downloadDesktop')}</Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('connectAgent.create.noDevicesDesktopHint')}
                    </Text>
                  </Flexbox>
                  <div className={styles.emptyOptionAction}>
                    <a href={DOWNLOAD_URL.default} rel={'noreferrer'} target={'_blank'}>
                      <Button
                        icon={<Icon icon={Download} size={14} />}
                        style={{ width: '100%' }}
                        type={'primary'}
                      >
                        {t('connectAgent.create.download')}
                      </Button>
                    </a>
                  </div>
                </div>
                <div className={styles.emptyOption}>
                  <span className={styles.emptyOptionIcon}>
                    <Icon icon={TerminalIcon} size={20} />
                  </span>
                  <Flexbox gap={3}>
                    <Text weight={500}>{t('connectAgent.create.connectCli')}</Text>
                    <Text fontSize={12} type={'secondary'}>
                      {t('connectAgent.create.noDevicesCliHint')}
                    </Text>
                  </Flexbox>
                  <div className={styles.emptyOptionAction}>
                    <div className={styles.emptyOptionCode}>
                      <code>{t('connectAgent.create.noDevicesCmd')}</code>
                      <CopyButton content={t('connectAgent.create.noDevicesCmd')} size={'small'} />
                    </div>
                  </div>
                </div>
              </div>
              <Flexbox horizontal justify={'flex-end'} padding={8}>
                <Button
                  icon={<Icon icon={RefreshCw} size={13} />}
                  loading={isRefreshing}
                  size={'small'}
                  type={'text'}
                  onClick={() => void refetchDevices()}
                >
                  {t('connectAgent.create.refresh')}
                </Button>
              </Flexbox>
            </div>
          ) : (
            <Flexbox gap={16}>
              {isDesktop && (
                <Flexbox gap={6}>
                  <SectionLabel>{t('connectAgent.create.thisDevice')}</SectionLabel>
                  <div className={styles.groupList}>
                    <DeviceRow
                      icon={<Icon icon={LaptopIcon} size={18} />}
                      statusText={t('connectAgent.create.online')}
                      subtitle={t('connectAgent.create.localDeviceDesc')}
                      title={t('connectAgent.create.localDevice')}
                      onClick={() => pickTarget({ kind: 'local' })}
                    />
                  </div>
                </Flexbox>
              )}
              {listedDevices.length > 0 && (
                <Flexbox gap={6}>
                  <Flexbox horizontal align={'center'} justify={'space-between'}>
                    <SectionLabel>{t('connectAgent.create.connectedDevices')}</SectionLabel>
                    <Button
                      icon={<Icon icon={RefreshCw} size={13} />}
                      loading={isRefreshing}
                      size={'small'}
                      type={'text'}
                      onClick={() => void refetchDevices()}
                    >
                      {t('connectAgent.create.refresh')}
                    </Button>
                  </Flexbox>
                  <div className={styles.groupList}>
                    {listedDevices.map((device) => (
                      <DeviceRow
                        icon={getDeviceIcon(device.platform, 18)}
                        key={device.deviceId}
                        offline={!device.online}
                        subtitle={device.hostname || device.deviceId}
                        title={deviceLabel(device)}
                        statusText={
                          device.online
                            ? t('connectAgent.create.online')
                            : t('connectAgent.create.offline')
                        }
                        onClick={() => pickTarget({ device, kind: 'device' })}
                      />
                    ))}
                  </div>
                </Flexbox>
              )}
              {isDesktop && listedDevices.length === 0 && (
                <Flexbox gap={4}>
                  <span>{t('connectAgent.create.noDevicesCliHint')}</span>
                  <Typography.Text code copyable>
                    {t('connectAgent.create.noDevicesCmd')}
                  </Typography.Text>
                </Flexbox>
              )}
            </Flexbox>
          )}
        </Flexbox>
      );
    }

    // ── Step 2: auto-scanned agent inventory ──
    if (step === 1 && target) {
      const scanning = scanState.status === 'scanning';

      return (
        <Flexbox gap={8} paddingBlock={'0 8px'}>
          {/* Rescan stays mounted (disabled while scanning) and the row reserves
              its height — no jump when the scan settles */}
          <Flexbox horizontal align={'center'} justify={'space-between'} style={{ minHeight: 28 }}>
            <SectionLabel>
              {t('connectAgent.create.stepAgents', { device: targetLabel })}
            </SectionLabel>
            {!(scanState.status === 'success' && detectedCount === 0) &&
              scanState.status !== 'error' && (
                <Button
                  disabled={scanning}
                  icon={<Icon icon={RefreshCw} size={13} />}
                  size={'small'}
                  type={'text'}
                  onClick={rescan}
                >
                  {t('connectAgent.create.rescan')}
                </Button>
              )}
          </Flexbox>

          {scanning && (
            <Flexbox gap={6}>
              <SectionLabel>{t('connectAgent.create.scanning')}</SectionLabel>
              <ScrollableAgentList>
                {[90, 70, 110, 80, 100, 75, 95]
                  .slice(0, CONNECTABLE_PROVIDERS.length)
                  .map((width, i) => (
                    <SkeletonRow key={i} width={width} />
                  ))}
              </ScrollableAgentList>
            </Flexbox>
          )}

          {scanState.status === 'error' && (
            <Alert
              showIcon
              description={scanState.error}
              message={t('connectAgent.create.scanFailed')}
              type={'error'}
              action={
                <Button size={'small'} onClick={rescan}>
                  {t('connectAgent.create.rescan')}
                </Button>
              }
            />
          )}

          {scanState.status === 'success' && detectedCount === 0 && (
            <Flexbox align={'center'} gap={12} paddingBlock={24}>
              <Icon icon={ScanSearch} size={28} />
              <Text strong>{t('connectAgent.create.noneDetected')}</Text>
              <Text style={{ textAlign: 'center' }} type={'secondary'}>
                {t('connectAgent.create.noneDetectedHint')}
              </Text>
              <Button
                icon={<Icon icon={RefreshCw} size={13} />}
                size={'small'}
                type={'primary'}
                onClick={rescan}
              >
                {t('connectAgent.create.rescanDevice')}
              </Button>
            </Flexbox>
          )}

          {scanState.status === 'success' && detectedCount > 0 && (
            <Flexbox gap={6}>
              <SectionLabel>
                {t('connectAgent.create.detectedCount', { total: detectedCount })}
              </SectionLabel>
              <ScrollableAgentList>
                {inventory.map(({ provider, status }) => (
                  <AgentScanRow
                    key={provider.type}
                    provider={provider}
                    selected={selectedTypes.includes(provider.type)}
                    status={status}
                    subtitle={t(`connectAgent.providerDesc.${provider.type}`)}
                    unavailableText={t('connectAgent.create.notInstalled')}
                    onToggle={() => toggleType(provider)}
                  />
                ))}
              </ScrollableAgentList>
            </Flexbox>
          )}

          {createError && (
            <Alert
              showIcon
              description={createError}
              message={t('connectAgent.create.createFailed')}
              type={'error'}
            />
          )}

          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Button
              icon={<Icon icon={ArrowLeft} size={14} />}
              type={'text'}
              onClick={() => setStep(0)}
            >
              {t('connectAgent.create.back')}
            </Button>
            <Flexbox horizontal align={'center'} gap={8}>
              {single && (
                <Button type={'text'} onClick={goConfirm}>
                  {t('connectAgent.create.customizeName')}
                </Button>
              )}
              <Tooltip
                title={selectedProviders.length > 0 ? '' : t('connectAgent.create.selectFirst')}
              >
                <Button
                  disabled={selectedProviders.length === 0}
                  loading={creating}
                  type={'primary'}
                  onClick={() => void handleCreate()}
                >
                  {selectedProviders.length === 0
                    ? t('connectAgent.create.connect')
                    : selectedProviders.length === 1
                      ? t('connectAgent.create.connectOne', { name: selectedProviders[0].title })
                      : t('connectAgent.create.connectMany', { total: selectedProviders.length })}
                </Button>
              </Tooltip>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      );
    }

    // ── Step 3: confirm (optional customization, single-select only) ──
    if (step === 2 && single) {
      return (
        <Flexbox gap={16} paddingBlock={'16px 8px'}>
          <SectionLabel>{t('connectAgent.create.stepConfirm')}</SectionLabel>
          <Flexbox horizontal align={'center'} gap={12}>
            <single.brand.Avatar size={44} />
            <Flexbox flex={1}>
              <Input
                maxLength={60}
                placeholder={t('connectAgent.create.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Flexbox>
          </Flexbox>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            maxLength={200}
            placeholder={t('connectAgent.create.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className={styles.groupList}>
            <div className={`${styles.row} ${styles.rowStatic}`}>
              <div className={styles.iconBox}>
                {target?.kind === 'device' ? (
                  getDeviceIcon(target.device.platform, 18)
                ) : (
                  <Icon icon={LaptopIcon} size={18} />
                )}
              </div>
              <Flexbox flex={1} gap={1} style={{ minWidth: 0 }}>
                <Text fontSize={13}>
                  {t('connectAgent.create.runsOn', { device: targetLabel })}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {single.title}
                  {singleVersion ? ` ${singleVersion}` : ''} ·{' '}
                  {t('connectAgent.create.detectedInScan')}
                </Text>
              </Flexbox>
              <Icon color={cssVar.colorSuccess} icon={CheckCircle2} size={16} />
            </div>
          </div>
          {createError && (
            <Alert
              showIcon
              description={createError}
              message={t('connectAgent.create.createFailed')}
              type={'error'}
            />
          )}
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Button
              icon={<Icon icon={ArrowLeft} size={14} />}
              type={'text'}
              onClick={() => setStep(1)}
            >
              {t('connectAgent.create.back')}
            </Button>
            <Button
              disabled={!name.trim()}
              loading={creating}
              type={'primary'}
              onClick={() => void handleCreate({ description, name })}
            >
              {t('connectAgent.create.connectOne', { name: single.title })}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    return null;
  },
);

ConnectAgentContent.displayName = 'ConnectAgentContent';

export interface OpenConnectAgentModalOptions {
  groupId?: string;
  visibility?: 'private' | 'public';
}

export const openConnectAgentModal = (options?: OpenConnectAgentModalOptions): ModalInstance => {
  // The done view promotes the result into the modal title ("N agents
  // connected") — content updates it through the instance, which only exists
  // after createModal returns, hence the holder indirection.
  const holder: { instance?: ModalInstance } = {};
  holder.instance = createModal({
    content: (
      <ConnectAgentContent
        groupId={options?.groupId}
        visibility={options?.visibility}
        onTitleChange={(title) => holder.instance?.update({ title })}
      />
    ),
    footer: null,
    maskClosable: true,
    styles: { content: { paddingBlockStart: 0 } },
    title: i18nT('connectAgent.create.title', { ns: 'chat' }),
    width: 520,
  });
  return holder.instance;
};
