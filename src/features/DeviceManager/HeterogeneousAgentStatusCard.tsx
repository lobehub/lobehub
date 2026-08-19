'use client';

import { isDesktop } from '@lobechat/const';
import { getHeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import type { DeviceListItem, HeterogeneousProviderConfig } from '@lobechat/types';
import { ActionIcon, CopyButton, Flexbox, Icon, Input, Tag, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleAlert, Loader2Icon, PencilLine, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refreshDeviceAgentScan } from '@/features/DeviceManager/useDeviceAgentScan';
import { useLocalHeteroAgentStatus } from '@/features/DeviceManager/useLocalHeteroAgentStatus';
import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useElectronStore } from '@/store/electron';

import { useDeviceStatus } from './deviceStatus';

const COMMAND_LINE_HEIGHT = 28;

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
    align-items: flex-start;
    justify-content: space-between;
  `,
  cardTitleWrap: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
  `,
  cardTitle: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  metaRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  metaText: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  pathWrap: css`
    display: flex;
    gap: 4px;
    align-items: center;

    min-width: 0;
    max-width: 100%;
  `,
  detailList: css`
    margin-block-start: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  detailRow: css`
    display: flex;
    gap: 16px;
    align-items: center;

    min-height: 48px;
    padding-block: 8px;

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
    gap: 8px;
    align-items: center;

    min-width: 0;
    height: ${COMMAND_LINE_HEIGHT}px;
  `,
  commandField: css`
    &:hover .command-edit-button {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  commandInput: css`
    width: 100%;
    font-family: ${cssVar.fontFamilyCode};

    &,
    &.ant-input,
    &.ant-input-affix-wrapper,
    &.ant-input-outlined,
    & input,
    & .ant-input,
    & .ant-input-affix-wrapper,
    & .ant-input-outlined {
      box-sizing: border-box;
      height: ${COMMAND_LINE_HEIGHT}px;
      min-height: ${COMMAND_LINE_HEIGHT}px;
      max-height: ${COMMAND_LINE_HEIGHT}px;
      border-radius: 999px !important;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 14px;
      line-height: ${COMMAND_LINE_HEIGHT - 2}px;
    }

    &,
    &.ant-input,
    &.ant-input-outlined,
    & input,
    & .ant-input,
    & .ant-input-outlined {
      padding-block: 0;
      padding-inline: 12px;
    }

    &.ant-input-affix-wrapper,
    & .ant-input-affix-wrapper {
      overflow: hidden;
      padding-block: 0;
      padding-inline: 12px;
    }

    &.ant-input-affix-wrapper input,
    & .ant-input-affix-wrapper input {
      height: ${COMMAND_LINE_HEIGHT - 2}px;
      padding: 0;
      border-radius: 999px !important;
      line-height: ${COMMAND_LINE_HEIGHT - 2}px;
    }
  `,
  commandInputWrap: css`
    display: flex;
    align-items: center;

    width: min(320px, 100%);
    max-width: 100%;
    height: ${COMMAND_LINE_HEIGHT}px;
  `,
  commandDisplay: css`
    display: inline-flex;
    align-items: center;

    box-sizing: border-box;
    max-width: 100%;
    height: ${COMMAND_LINE_HEIGHT}px;
    padding-block: 0;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    background: ${cssVar.colorFillSecondary};
  `,
  commandEditButton: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
  `,
  commandText: css`
    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 14px;
    line-height: 20px;
    color: ${cssVar.colorText};
  `,
  accountValue: css`
    font-size: 15px;
    color: ${cssVar.colorText};
  `,
  path: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  unavailableText: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export interface HeterogeneousAgentStatusCardProps {
  /**
   * The device this card inspects; `undefined` means the current machine
   * (desktop IPC detection, no gateway probe).
   */
  device?: DeviceListItem;
  onCommandChange?: (command: string) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

/**
 * Startup-command status card for ONE device. The header's CLI verdict comes
 * from the Electron IPC probe when the card inspects the current machine, and
 * from a gateway scan for any other device. The launch command itself is
 * agent-level configuration, so the editor is shared no matter which device is
 * selected.
 */
const HeterogeneousAgentStatusCard = memo<HeterogeneousAgentStatusCardProps>(
  ({ device, onCommandChange, provider }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();
    const { allowed: canEdit } = usePermission('edit_own_content');
    const providerConfig = getHeterogeneousAgentClientConfig(provider.type);
    const defaultCommand = providerConfig?.defaultCommand || '';
    const resolvedCommand = provider.command?.trim() || defaultCommand;
    const isUsingCustomCommand = resolvedCommand !== defaultCommand;
    const [commandInput, setCommandInput] = useState(resolvedCommand);
    const [isEditingCommand, setIsEditingCommand] = useState(false);
    const [savingCommand, setSavingCommand] = useState(false);
    const commandInputRef = useRef<HTMLInputElement | null>(null);

    const displayName = providerConfig?.title || provider.type;
    const AgentIcon = providerConfig?.icon;

    // The current machine's gateway deviceId (desktop only), used to tell the
    // card's own device from a remote one.
    useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
    const gatewayDeviceInfo = useElectronStore((s) => s.gatewayDeviceInfo);
    const currentDeviceId = isDesktop ? gatewayDeviceInfo?.deviceId : undefined;
    const isCurrentMachine = device ? device.deviceId === currentDeviceId : isDesktop;

    // The current machine is probed over Electron IPC — fast and independent
    // of the gateway connection. The card and the device-tab dots share this
    // single SWR-cached probe.
    const local = useLocalHeteroAgentStatus(
      isCurrentMachine ? provider.type : undefined,
      isCurrentMachine ? resolvedCommand : undefined,
    );
    const { auth, detecting, redetect: redetectLocal, status } = local;

    // Header verdict: current machine → local IPC detection; remote device →
    // gateway scan; no device (desktop fallback) → local IPC detection.
    const { available, checking, notInstalled, offline, outdated, path, version } = useDeviceStatus(
      {
        agentType: provider.type,
        currentDeviceId,
        device,
        localDetecting: detecting,
        localStatus: status,
      },
    );

    // Re-probe the local CLI and every connected device's CLI together.
    const redetect = useCallback(() => {
      redetectLocal();
      refreshDeviceAgentScan();
    }, [redetectLocal]);

    useEffect(() => {
      setCommandInput(resolvedCommand);
    }, [resolvedCommand]);

    useEffect(() => {
      if (!isEditingCommand) return;

      const focusCommandInput = () => {
        commandInputRef.current?.focus();
        commandInputRef.current?.select();
      };

      const timer = window.setTimeout(focusCommandInput, 0);

      return () => {
        window.clearTimeout(timer);
      };
    }, [isEditingCommand]);

    const startEditingCommand = useCallback(() => {
      if (!canEdit) return;
      if (savingCommand) return;

      setCommandInput(resolvedCommand);
      setIsEditingCommand(true);
    }, [canEdit, resolvedCommand, savingCommand]);

    const cancelEditingCommand = useCallback(() => {
      setCommandInput(resolvedCommand);
      setIsEditingCommand(false);
    }, [resolvedCommand]);

    const commitCommand = useCallback(async () => {
      if (!canEdit) return;

      const normalizedCommand = commandInput.trim() || defaultCommand;
      setCommandInput(normalizedCommand);

      if (!normalizedCommand || normalizedCommand === resolvedCommand || savingCommand) {
        setIsEditingCommand(false);
        return;
      }

      try {
        setSavingCommand(true);
        await onCommandChange?.(normalizedCommand);
        setIsEditingCommand(false);
      } finally {
        setSavingCommand(false);
      }
    }, [canEdit, commandInput, defaultCommand, onCommandChange, resolvedCommand, savingCommand]);

    const renderStatusTag = () => {
      if (checking) {
        return (
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            {t('settingSystemTools.detecting')}
          </Tag>
        );
      }

      if (available) {
        return (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            {t('settingSystemTools.status.available')}
          </Tag>
        );
      }

      if (offline) {
        return (
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            {t('heterogeneousStatus.devices.offline')}
          </Tag>
        );
      }

      if (outdated) {
        return (
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>
            {t('heterogeneousStatus.devices.outdated')}
          </Tag>
        );
      }

      return (
        <Tag color="error" style={{ marginInlineEnd: 0 }}>
          {t('settingSystemTools.status.unavailable')}
        </Tag>
      );
    };

    const renderStatusMeta = () => {
      if (checking) {
        return (
          <Flexbox horizontal align="center" gap={8}>
            <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.6 }} />
            <Text className={styles.metaText}>
              {t('heterogeneousStatus.detecting', { name: displayName })}
            </Text>
          </Flexbox>
        );
      }

      if (available) {
        return (
          <Flexbox horizontal align="center" className={styles.metaRow} gap={8}>
            {version && (
              <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                {version}
              </Tag>
            )}
            {path && (
              <Tooltip title={path}>
                <Flexbox horizontal align="center" className={styles.pathWrap} gap={4}>
                  <Text ellipsis className={styles.path}>
                    {path}
                  </Text>
                  <CopyButton content={path} size="small" />
                </Flexbox>
              </Tooltip>
            )}
          </Flexbox>
        );
      }

      if (offline) {
        return (
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Icon color="var(--ant-color-warning)" icon={CircleAlert} size={16} />
            <Text className={styles.unavailableText}>
              {t('heterogeneousStatus.devices.offline')}
            </Text>
          </Flexbox>
        );
      }

      if (outdated) {
        return (
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Icon color="var(--ant-color-warning)" icon={CircleAlert} size={16} />
            <Text className={styles.unavailableText}>
              {t('heterogeneousStatus.devices.outdatedDesc', { name: displayName })}
            </Text>
          </Flexbox>
        );
      }

      if (notInstalled) {
        return (
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
            <Text className={styles.unavailableText}>
              {t('heterogeneousStatus.unavailable', { name: displayName })}
            </Text>
          </Flexbox>
        );
      }

      // Probe failed (older client without the scan tool, gateway error…).
      return (
        <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
          <Icon color="var(--ant-color-warning)" icon={CircleAlert} size={16} />
          <Text className={styles.unavailableText}>
            {t('heterogeneousStatus.devices.checkFailed')}
          </Text>
        </Flexbox>
      );
    };

    const renderCommandEditor = () => {
      return (
        <div className={`${styles.detailRow} ${styles.commandField}`}>
          <Text className={styles.detailLabel}>{t('heterogeneousStatus.command.label')}</Text>
          <div className={styles.detailContent}>
            {isEditingCommand ? (
              <div className={styles.commandInputWrap}>
                <Input
                  className={styles.commandInput}
                  disabled={!canEdit || savingCommand}
                  placeholder={t('heterogeneousStatus.command.placeholder')}
                  ref={commandInputRef as never}
                  value={commandInput}
                  onBlur={() => {
                    void commitCommand();
                  }}
                  onChange={(event) => {
                    setCommandInput(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelEditingCommand();
                      return;
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void commitCommand();
                    }
                  }}
                />
              </div>
            ) : (
              <div className={styles.commandDisplay}>
                <Text ellipsis className={styles.commandText}>
                  {resolvedCommand}
                </Text>
              </div>
            )}
            {!isEditingCommand && !savingCommand && (
              <Tooltip title={t('heterogeneousStatus.command.edit')}>
                <ActionIcon
                  aria-label={t('heterogeneousStatus.command.edit')}
                  className={`command-edit-button ${styles.commandEditButton}`}
                  disabled={!canEdit}
                  icon={PencilLine}
                  size="small"
                  onClick={startEditingCommand}
                />
              </Tooltip>
            )}
          </div>
        </div>
      );
    };

    const renderAuth = () => {
      // Auth/account state only exists on the machine that runs the CLI
      // locally — remote devices have no credential state to report here.
      if (!isCurrentMachine || provider.type !== 'claude-code' || checking || !auth?.loggedIn)
        return null;

      const authMode =
        auth.authMethod === 'claude.ai' || auth.apiProvider === 'firstParty'
          ? t('heterogeneousStatus.auth.subscription')
          : t('heterogeneousStatus.auth.api');

      return (
        <>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('heterogeneousStatus.auth.label')}</Text>
            <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
              <Text className={styles.accountValue}>{authMode}</Text>
            </Flexbox>
          </div>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('heterogeneousStatus.account.label')}</Text>
            <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
              {auth.email && (
                <Text ellipsis className={styles.accountValue}>
                  {auth.email}
                </Text>
              )}
            </Flexbox>
          </div>
          {auth.subscriptionType && (
            <div className={styles.detailRow}>
              <Text className={styles.detailLabel}>{t('heterogeneousStatus.plan.label')}</Text>
              <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
                <Text className={styles.accountValue}>{auth.subscriptionType.toUpperCase()}</Text>
              </Flexbox>
            </div>
          )}
        </>
      );
    };

    // The install guide targets THIS machine's system tools, so it only makes
    // sense while the card inspects the local CLI.
    const showCliInstallGuide =
      isCurrentMachine &&
      (provider.type === 'amp' ||
        provider.type === 'claude-code' ||
        provider.type === 'codebuddy' ||
        provider.type === 'codex' ||
        provider.type === 'cursor' ||
        provider.type === 'kimi-code' ||
        provider.type === 'opencode' ||
        provider.type === 'pi' ||
        provider.type === 'qoder' ||
        provider.type === 'trae') &&
      !checking &&
      !available &&
      !isUsingCustomCommand;

    return (
      <Flexbox className={styles.card} gap={12}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleWrap}>
            <div className={styles.cardTitle}>
              {AgentIcon && <AgentIcon size={16} />}
              <Text strong>{`${displayName} CLI`}</Text>
            </div>
            <div className={styles.metaRow}>
              {renderStatusTag()}
              {renderStatusMeta()}
            </div>
          </div>
          <Tooltip title={t('heterogeneousStatus.redetect')}>
            <ActionIcon
              aria-label={t('heterogeneousStatus.redetect')}
              disabled={checking}
              icon={RefreshCw}
              loading={checking}
              size="small"
              onClick={redetect}
            />
          </Tooltip>
        </div>
        <div className={styles.detailList}>
          {renderCommandEditor()}
          {renderAuth()}
        </div>
        {showCliInstallGuide && (
          <HeterogeneousAgentStatusGuide
            agentType={provider.type}
            variant={'embedded'}
            onOpenSystemTools={() => navigate('/settings/system-tools')}
          />
        )}
      </Flexbox>
    );
  },
);

HeterogeneousAgentStatusCard.displayName = 'HeterogeneousAgentStatusCard';

export default HeterogeneousAgentStatusCard;
