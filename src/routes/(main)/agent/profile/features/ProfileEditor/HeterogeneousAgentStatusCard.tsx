'use client';

import { isDesktop } from '@lobechat/const';
import { type BinaryStatus, type ClaudeAuthStatus } from '@lobechat/electron-client-ipc';
import { isHeterogeneousProviderBindingSupported } from '@lobechat/heterogeneous-agents';
import {
  getHeterogeneousAgentClientConfig,
  isRemoteHeterogeneousType,
} from '@lobechat/heterogeneous-agents/client';
import type {
  HeterogeneousApiConfig,
  HeterogeneousAuthMode,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import { ActionIcon, CopyButton, Flexbox, Icon, Input, Tag, Text, Tooltip } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon, PencilLine, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import { useProviderBindingCompatibleProviders } from '@/features/HeterogeneousAgent/hooks/useProviderBinding';
import ModelSelect from '@/features/ModelSelect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { binaryService } from '@/services/electron/binary';

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

interface HeterogeneousAgentStatusCardProps {
  apiModeAvailable?: boolean;
  apiModeLabEnabled?: boolean;
  /**
   * Provider binding is blocked because the agent is workspace-scoped: the
   * binding UI would offer workspace providers while Desktop main resolves
   * the reference in the personal scope only.
   */
  apiModeWorkspaceBlocked?: boolean;
  onApiConfigChange?: (apiConfig: HeterogeneousApiConfig | undefined) => Promise<void> | void;
  onAuthModeChange?: (authMode: HeterogeneousAuthMode) => Promise<void> | void;
  onCommandChange?: (command: string) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

const HeterogeneousAgentStatusCard = memo<HeterogeneousAgentStatusCardProps>(
  ({
    apiModeAvailable = false,
    apiModeLabEnabled = false,
    apiModeWorkspaceBlocked = false,
    provider,
    onApiConfigChange,
    onAuthModeChange,
    onCommandChange,
  }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();
    const { allowed: canEdit } = usePermission('edit_own_content');
    const providerConfig = getHeterogeneousAgentClientConfig(provider.type);
    const defaultCommand = providerConfig?.defaultCommand || '';
    const resolvedCommand = provider.command?.trim() || defaultCommand;
    const isUsingCustomCommand = resolvedCommand !== defaultCommand;
    const [status, setStatus] = useState<BinaryStatus | undefined>();
    const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null);
    const [commandInput, setCommandInput] = useState(resolvedCommand);
    const [detecting, setDetecting] = useState(true);
    const [isEditingCommand, setIsEditingCommand] = useState(false);
    const [savingCommand, setSavingCommand] = useState(false);
    const commandInputRef = useRef<HTMLInputElement | null>(null);
    const authMode = provider.authMode ?? 'subscription';
    const providerBindingSupported = isHeterogeneousProviderBindingSupported(provider.type);
    const { modelsByProvider, providers: compatibleProviders } =
      useProviderBindingCompatibleProviders(provider.type);
    const compatibleProviderIds = useMemo(
      () => compatibleProviders.map(({ id }) => id),
      [compatibleProviders],
    );

    const displayName = providerConfig?.title || provider.type;
    const AgentIcon = providerConfig?.icon;
    const showCliInstallGuide =
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
      !detecting &&
      !status?.available &&
      !isUsingCustomCommand;

    const handleAuthModeChange = useCallback(
      async (nextAuthMode: HeterogeneousAuthMode) => {
        if (!canEdit || nextAuthMode === authMode) return;
        if (nextAuthMode === 'api' && (!apiModeLabEnabled || !apiModeAvailable)) return;

        await onAuthModeChange?.(nextAuthMode);
        if (nextAuthMode !== 'api' || provider.apiConfig) return;

        const firstProvider = compatibleProviders[0];
        const firstModel = firstProvider && modelsByProvider[firstProvider.id]?.[0];
        if (firstProvider && firstModel) {
          await onApiConfigChange?.({ model: firstModel.id, providerId: firstProvider.id });
        }
      },
      [
        apiModeAvailable,
        apiModeLabEnabled,
        authMode,
        canEdit,
        compatibleProviders,
        modelsByProvider,
        onApiConfigChange,
        onAuthModeChange,
        provider.apiConfig,
      ],
    );

    const handlePrimaryModelChange = useCallback(
      async ({ model, provider: providerId }: { model: string; provider: string }) => {
        if (!canEdit) return;
        const smallFastModel =
          provider.apiConfig?.providerId === providerId
            ? provider.apiConfig.smallFastModel
            : undefined;
        await onApiConfigChange?.({ model, providerId, smallFastModel });
      },
      [canEdit, onApiConfigChange, provider.apiConfig],
    );

    const handleSmallFastModelChange = useCallback(
      async (smallFastModel: string | null) => {
        if (!canEdit || !provider.apiConfig) return;
        await onApiConfigChange?.({ ...provider.apiConfig, smallFastModel });
      },
      [canEdit, onApiConfigChange, provider.apiConfig],
    );

    const detect = useCallback(async () => {
      // Remote platform agents (openclaw, hermes, …) have no local CLI to detect.
      if (isRemoteHeterogeneousType(provider.type) || !isDesktop || !resolvedCommand) {
        setDetecting(false);
        return;
      }

      setDetecting(true);
      try {
        const result = await binaryService.detectHeterogeneousAgentCommand({
          agentType: provider.type,
          command: resolvedCommand,
        });
        setStatus(result);
        if (!result.available) setAuth(null);
      } catch (error) {
        console.error('[HeterogeneousAgentStatusCard] Failed to detect CLI:', error);
        setStatus({ available: false, error: (error as Error).message });
        setAuth(null);
      } finally {
        setDetecting(false);
      }
    }, [provider.type, resolvedCommand]);

    useEffect(() => {
      void detect();
    }, [detect]);

    useEffect(() => {
      if (provider.type !== 'claude-code' || authMode === 'api' || !status?.available) {
        setAuth(null);
        return;
      }

      // Keep the last subscription account visible while a redetect is in flight.
      if (detecting) return;

      let cancelled = false;
      void (async () => {
        try {
          const result = await binaryService.getClaudeAuthStatus(resolvedCommand);
          if (!cancelled) setAuth(result);
        } catch (error) {
          console.warn('[HeterogeneousAgentStatusCard] Failed to get Claude auth status:', error);
          if (!cancelled) setAuth(null);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [authMode, detecting, provider.type, resolvedCommand, status?.available]);

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
      if (detecting) {
        return (
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            {t('settingSystemTools.detecting')}
          </Tag>
        );
      }

      if (!status || !status.available) {
        return (
          <Tag color="error" style={{ marginInlineEnd: 0 }}>
            {t('settingSystemTools.status.unavailable')}
          </Tag>
        );
      }

      return (
        <Tag color="success" style={{ marginInlineEnd: 0 }}>
          {t('settingSystemTools.status.available')}
        </Tag>
      );
    };

    const renderStatusMeta = () => {
      if (detecting) {
        return (
          <Flexbox horizontal align="center" gap={8}>
            <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.6 }} />
            <Text className={styles.metaText}>
              {t('heterogeneousStatus.detecting', { name: displayName })}
            </Text>
          </Flexbox>
        );
      }

      if (!status || !status.available) {
        return (
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
            <Text className={styles.unavailableText}>
              {t('heterogeneousStatus.unavailable', { name: displayName })}
            </Text>
          </Flexbox>
        );
      }

      return (
        <Flexbox horizontal align="center" className={styles.metaRow} gap={8}>
          {status.version && (
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              {status.version}
            </Tag>
          )}
          {status.path && (
            <Tooltip title={status.path}>
              <Flexbox horizontal align="center" className={styles.pathWrap} gap={4}>
                <Text ellipsis className={styles.path}>
                  {status.path}
                </Text>
                <CopyButton content={status.path} size="small" />
              </Flexbox>
            </Tooltip>
          )}
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

    const renderAuthMode = () => {
      if (!providerBindingSupported || detecting || !status?.available) return null;
      // Keep leftover API-mode agents visible so they can switch back; hide the
      // experiment entirely for subscription agents until Labs is enabled.
      if (!apiModeLabEnabled && authMode !== 'api') return null;

      const apiOptionEnabled = apiModeLabEnabled && apiModeAvailable;

      return (
        <div className={styles.detailRow}>
          <Text className={styles.detailLabel}>{t('heterogeneousStatus.auth.label')}</Text>
          <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Segmented
              disabled={!canEdit}
              size="small"
              value={authMode}
              options={[
                {
                  label: t('heterogeneousStatus.auth.subscription'),
                  value: 'subscription',
                },
                {
                  disabled: !apiOptionEnabled,
                  label: t('heterogeneousStatus.auth.api'),
                  value: 'api',
                },
              ]}
              onChange={(value) => {
                void handleAuthModeChange(value as HeterogeneousAuthMode);
              }}
            />
            {!apiModeLabEnabled ? (
              <>
                <Text className={styles.unavailableText}>
                  {t('heterogeneousStatus.apiMode.labDisabled')}
                </Text>
                <Text
                  className={styles.metaText}
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => navigate('/settings/labs')}
                >
                  {t('heterogeneousStatus.apiMode.enableInLabs')}
                </Text>
              </>
            ) : !apiModeAvailable ? (
              <Text className={styles.unavailableText}>
                {t(
                  apiModeWorkspaceBlocked
                    ? 'heterogeneousStatus.apiMode.workspaceUnsupported'
                    : 'heterogeneousStatus.apiMode.localOnly',
                )}
              </Text>
            ) : null}
          </Flexbox>
        </div>
      );
    };

    const renderSubscriptionAccount = () => {
      if (
        provider.type !== 'claude-code' ||
        authMode !== 'subscription' ||
        detecting ||
        !status?.available ||
        !auth?.loggedIn
      )
        return null;

      return (
        <>
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

    const renderApiConfig = () => {
      if (
        !providerBindingSupported ||
        authMode !== 'api' ||
        !apiModeLabEnabled ||
        !apiModeAvailable ||
        detecting ||
        !status?.available
      )
        return null;

      if (compatibleProviders.length === 0) {
        return (
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('heterogeneousStatus.apiMode.model')}</Text>
            <Flexbox horizontal align="center" gap={8} style={{ flexWrap: 'wrap' }}>
              <Text className={styles.unavailableText}>
                {t(
                  provider.type === 'codex'
                    ? 'heterogeneousStatus.apiMode.noResponsesProviders'
                    : 'heterogeneousStatus.apiMode.noProviders',
                )}
              </Text>
              <Text
                className={styles.metaText}
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => navigate('/settings/provider')}
              >
                {t('heterogeneousStatus.apiMode.configureProvider')}
              </Text>
            </Flexbox>
          </div>
        );
      }

      return (
        <>
          <div className={styles.detailRow}>
            <Text className={styles.detailLabel}>{t('heterogeneousStatus.apiMode.model')}</Text>
            <ModelSelect
              initialWidth
              disabled={!canEdit}
              placeholder={t('heterogeneousStatus.apiMode.modelPlaceholder')}
              popupWidth={360}
              providerIds={compatibleProviderIds}
              value={
                provider.apiConfig
                  ? { model: provider.apiConfig.model, provider: provider.apiConfig.providerId }
                  : undefined
              }
              onChange={(value) => {
                void handlePrimaryModelChange(value);
              }}
            />
          </div>
          {provider.type === 'claude-code' && provider.apiConfig && (
            <div className={styles.detailRow} style={{ alignItems: 'flex-start' }}>
              <Text className={styles.detailLabel} style={{ paddingBlockStart: 14 }}>
                {t('heterogeneousStatus.apiMode.smallFastModel')}
              </Text>
              <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
                <ModelSelect
                  allowClear
                  initialWidth
                  disabled={!canEdit}
                  placeholder={t('heterogeneousStatus.apiMode.smallFastModelPlaceholder')}
                  popupWidth={360}
                  providerIds={[provider.apiConfig.providerId]}
                  value={
                    provider.apiConfig.smallFastModel
                      ? {
                          model: provider.apiConfig.smallFastModel,
                          provider: provider.apiConfig.providerId,
                        }
                      : undefined
                  }
                  onChange={({ model }) => {
                    void handleSmallFastModelChange(model);
                  }}
                  onClear={() => {
                    void handleSmallFastModelChange(null);
                  }}
                />
                <Text className={styles.metaText}>
                  {t('heterogeneousStatus.apiMode.smallFastModelDesc')}
                </Text>
              </Flexbox>
            </div>
          )}
        </>
      );
    };

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
              disabled={detecting}
              icon={RefreshCw}
              loading={detecting}
              size="small"
              onClick={detect}
            />
          </Tooltip>
        </div>
        <div className={styles.detailList}>
          {renderCommandEditor()}
          {renderAuthMode()}
          {renderSubscriptionAccount()}
          {renderApiConfig()}
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
