'use client';

import { isDesktop } from '@lobechat/const';
import type { ClaudeAuthStatus, ToolStatus } from '@lobechat/electron-client-ipc';
import { getHeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import type {
  HeterogeneousProviderBillingType,
  HeterogeneousProviderConfig,
} from '@lobechat/types';
import {
  ActionIcon,
  CopyButton,
  Flexbox,
  Icon,
  Input,
  Segmented,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStyles } from 'antd-style';
import {
  Loader2Icon,
  PencilLine,
  PlusIcon,
  RefreshCw,
  SaveIcon,
  Trash2Icon,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { toolDetectorService } from '@/services/electron/toolDetector';

import type { ClaudeCodeApiProviderPreset } from './claudeCodeProviderPresets';
import {
  CLAUDE_CODE_API_PROVIDER_PRESETS,
  DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET,
  formatRequiredEnvGroup,
  getClaudeCodeApiProviderPreset,
  inferClaudeCodeApiProviderPresetId,
} from './claudeCodeProviderPresets';

const COMMAND_LINE_HEIGHT = 28;

interface EnvRow {
  id: string;
  key: string;
  value: string;
}

interface EnvConnectionResult {
  message: string;
  ok: boolean;
  responseTimeMs?: number;
  status?: number;
}

const envToRows = (env?: Record<string, string>): EnvRow[] =>
  Object.entries(env ?? {}).map(([key, value], index) => ({
    id: `${key}-${index}`,
    key,
    value,
  }));

const createEnvRow = (key = '', value = ''): EnvRow => ({
  id: `${key || 'new'}-${Date.now()}`,
  key,
  value,
});

const getDefaultRequiredEnvKeys = (required: string[][]) => [
  ...new Set(required.map((group) => group[0])),
];

const ensureEnvRows = (rows: EnvRow[], keys: string[]): EnvRow[] => {
  const existingKeys = new Set(rows.map((row) => row.key));
  const missingRows = keys.filter((key) => !existingKeys.has(key)).map((key) => createEnvRow(key));

  return [...rows, ...missingRows];
};

const emptyEnvRow = (): EnvRow => createEnvRow();

const rowsToEnv = (rows: EnvRow[]): Record<string, string> | undefined => {
  const env: Record<string, string> = {};

  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;

    env[key] = row.value;
  }

  return Object.keys(env).length > 0 ? env : undefined;
};

const findMissingRequiredEnvGroups = (
  env: Record<string, string> | undefined,
  required: string[][],
) => required.filter((group) => !group.some((key) => env?.[key]?.trim()));

const isSensitiveEnvKey = (key: string) => /TOKEN|API_KEY|SECRET|PASSWORD/i.test(key);

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    padding-block: 16px 4px;
    padding-inline: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;

    background: ${token.colorBgContainer};
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
    color: ${token.colorTextSecondary};
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
    border-block-start: 1px solid ${token.colorBorderSecondary};
  `,
  detailRow: css`
    display: flex;
    gap: 16px;
    align-items: center;

    min-height: 48px;
    padding-block: 8px;

    & + & {
      border-block-start: 1px solid ${token.colorBorderSecondary};
    }
  `,
  detailLabel: css`
    flex-shrink: 0;

    width: 96px;

    font-size: 12px;
    color: ${token.colorTextTertiary};
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
    font-family: ${token.fontFamilyCode};

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

      font-family: ${token.fontFamilyCode};
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
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 999px;

    background: ${token.colorFillSecondary};
  `,
  commandEditButton: css`
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
  `,
  commandText: css`
    min-width: 0;

    font-family: ${token.fontFamilyCode};
    font-size: 14px;
    line-height: 20px;
    color: ${token.colorText};
  `,
  billingContent: css`
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  billingHint: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  envActions: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;
  `,
  envEditor: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
  `,
  envDetailRow: css`
    align-items: flex-start;

    > div:first-child {
      padding-block-start: 6px;
    }
  `,
  envPresetSelect: css`
    width: min(320px, 100%);
  `,
  envInput: css`
    min-width: 120px;
    font-family: ${token.fontFamilyCode};
  `,
  envRow: css`
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
  `,
  envSummary: css`
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  envSummaryText: css`
    max-width: 100%;
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
  envToolbar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  envConnectionError: css`
    font-size: 12px;
    color: ${token.colorError};
  `,
  envConnectionSuccess: css`
    font-size: 12px;
    color: ${token.colorSuccess};
  `,
  envValidation: css`
    font-size: 12px;
    color: ${token.colorError};
  `,
  accountValue: css`
    font-size: 15px;
    color: ${token.colorText};
  `,
  path: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  unavailableText: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
  `,
}));

interface HeterogeneousAgentStatusCardProps {
  onBillingTypeChange?: (billingType: HeterogeneousProviderBillingType) => Promise<void> | void;
  onCommandChange?: (command: string) => Promise<void> | void;
  onEnvChange?: (env?: Record<string, string>) => Promise<void> | void;
  onProviderPresetChange?: (preset: ClaudeCodeApiProviderPreset) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

const HeterogeneousAgentStatusCard = memo<HeterogeneousAgentStatusCardProps>(
  ({ provider, onBillingTypeChange, onCommandChange, onEnvChange, onProviderPresetChange }) => {
    const { t } = useTranslation('setting');
    const { styles } = useStyles();
    const navigate = useNavigate();
    const providerConfig = getHeterogeneousAgentClientConfig(provider.type);
    const defaultCommand = providerConfig?.command || '';
    const resolvedCommand = provider.command?.trim() || defaultCommand;
    const isUsingCustomCommand = resolvedCommand !== defaultCommand;
    const persistedBillingType = provider.billingType ?? (provider.env ? 'api' : 'subscription');
    const [billingType, setBillingType] =
      useState<HeterogeneousProviderBillingType>(persistedBillingType);
    const isClaudeCode = provider.type === 'claude-code';
    const isApiBilling = isClaudeCode && billingType === 'api';
    const [status, setStatus] = useState<ToolStatus | undefined>();
    const [auth, setAuth] = useState<ClaudeAuthStatus | null>(null);
    const [commandInput, setCommandInput] = useState(resolvedCommand);
    const [detecting, setDetecting] = useState(true);
    const [envError, setEnvError] = useState<string | undefined>();
    const [envConnectionResult, setEnvConnectionResult] = useState<
      EnvConnectionResult | undefined
    >();
    const [isEditingCommand, setIsEditingCommand] = useState(false);
    const [isEditingEnv, setIsEditingEnv] = useState(false);
    const [checkingEnvConnection, setCheckingEnvConnection] = useState(false);
    const [savingCommand, setSavingCommand] = useState(false);
    const [savingEnv, setSavingEnv] = useState(false);
    const [envRows, setEnvRows] = useState(() => envToRows(provider.env));
    const [envPresetId, setEnvPresetId] = useState(() =>
      inferClaudeCodeApiProviderPresetId(provider.env),
    );
    const commandInputRef = useRef<HTMLInputElement | null>(null);
    const newEnvRowIndexRef = useRef(0);

    const displayName = providerConfig?.title || provider.type;
    const AgentIcon = providerConfig?.icon;
    const envEntries = useMemo(() => Object.entries(provider.env ?? {}), [provider.env]);
    const envNames = useMemo(() => envEntries.map(([key]) => key), [envEntries]);
    const envPresetOptions = useMemo(
      () =>
        CLAUDE_CODE_API_PROVIDER_PRESETS.map((preset) => ({
          label: preset.label,
          value: preset.id,
        })),
      [],
    );
    const selectedEnvPreset =
      getClaudeCodeApiProviderPreset(envPresetId) ?? DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET;
    const showCliInstallGuide =
      (isClaudeCode || provider.type === 'codex') &&
      !detecting &&
      !status?.available &&
      !isUsingCustomCommand;

    const fetchAuth = useCallback(async () => {
      if (provider.type !== 'claude-code' || isApiBilling) {
        setAuth(null);
        return;
      }

      try {
        const result = await toolDetectorService.getClaudeAuthStatus(resolvedCommand);
        setAuth(result);
      } catch (error) {
        console.warn('[HeterogeneousAgentStatusCard] Failed to get Claude auth status:', error);
        setAuth(null);
      }
    }, [isApiBilling, provider.type, resolvedCommand]);

    const detect = useCallback(async () => {
      if (!isDesktop || !resolvedCommand) {
        setDetecting(false);
        return;
      }

      setDetecting(true);
      try {
        const result = await toolDetectorService.detectHeterogeneousAgentCommand({
          agentType: provider.type,
          command: resolvedCommand,
        });
        setStatus(result);
        if (result.available) {
          void fetchAuth();
        } else {
          setAuth(null);
        }
      } catch (error) {
        console.error('[HeterogeneousAgentStatusCard] Failed to detect CLI:', error);
        setStatus({ available: false, error: (error as Error).message });
        setAuth(null);
      } finally {
        setDetecting(false);
      }
    }, [fetchAuth, provider.type, resolvedCommand]);

    useEffect(() => {
      void detect();
    }, [detect]);

    useEffect(() => {
      setCommandInput(resolvedCommand);
    }, [resolvedCommand]);

    useEffect(() => {
      setBillingType(persistedBillingType);
    }, [persistedBillingType]);

    useEffect(() => {
      if (isEditingEnv) return;

      setEnvRows(envToRows(provider.env));
      setEnvPresetId(inferClaudeCodeApiProviderPresetId(provider.env));
      setEnvConnectionResult(undefined);
    }, [isEditingEnv, provider.env]);

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
      if (savingCommand) return;

      setCommandInput(resolvedCommand);
      setIsEditingCommand(true);
    }, [resolvedCommand, savingCommand]);

    const cancelEditingCommand = useCallback(() => {
      setCommandInput(resolvedCommand);
      setIsEditingCommand(false);
    }, [resolvedCommand]);

    const commitCommand = useCallback(async () => {
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
    }, [commandInput, defaultCommand, onCommandChange, resolvedCommand, savingCommand]);

    const startEditingEnv = useCallback(() => {
      if (savingEnv) return;

      const rows = envToRows(provider.env);
      if (isApiBilling) {
        const presetId = inferClaudeCodeApiProviderPresetId(provider.env);
        const preset =
          getClaudeCodeApiProviderPreset(presetId) ?? DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET;
        setEnvPresetId(presetId);
        setEnvRows(ensureEnvRows(rows, getDefaultRequiredEnvKeys(preset.required)));
      } else {
        setEnvRows(rows.length > 0 ? rows : [emptyEnvRow()]);
      }
      setEnvError(undefined);
      setEnvConnectionResult(undefined);
      setIsEditingEnv(true);
    }, [isApiBilling, provider.env, savingEnv]);

    const cancelEditingEnv = useCallback(() => {
      setEnvRows(envToRows(provider.env));
      setEnvError(undefined);
      setEnvConnectionResult(undefined);
      setIsEditingEnv(false);
    }, [provider.env]);

    const addEnvRow = useCallback(() => {
      const nextIndex = newEnvRowIndexRef.current + 1;
      newEnvRowIndexRef.current = nextIndex;

      setEnvConnectionResult(undefined);
      setEnvRows((rows) => [...rows, { id: `new-${nextIndex}`, key: '', value: '' }]);
    }, []);

    const updateEnvRow = useCallback((id: string, field: 'key' | 'value', value: string) => {
      setEnvConnectionResult(undefined);
      setEnvRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    }, []);

    const removeEnvRow = useCallback((id: string) => {
      setEnvConnectionResult(undefined);
      setEnvRows((rows) => rows.filter((row) => row.id !== id));
    }, []);

    const applyEnvPreset = useCallback((presetId: string) => {
      const preset =
        getClaudeCodeApiProviderPreset(presetId) ?? DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET;

      setEnvPresetId(preset.id);
      setEnvRows(envToRows(preset.env));
      setEnvError(undefined);
      setEnvConnectionResult(undefined);
    }, []);

    const commitEnv = useCallback(async () => {
      if (savingEnv) return;

      const nextEnv = rowsToEnv(envRows);
      if (isApiBilling) {
        const missingGroups = findMissingRequiredEnvGroups(nextEnv, selectedEnvPreset.required);

        if (missingGroups.length > 0) {
          setEnvError(
            t('heterogeneousStatus.env.required', {
              keys: missingGroups.map(formatRequiredEnvGroup).join(', '),
            }),
          );
          return;
        }
      }

      try {
        setSavingEnv(true);
        await onEnvChange?.(nextEnv);
        if (isApiBilling) {
          await onProviderPresetChange?.(selectedEnvPreset);
        }
        setEnvError(undefined);
        setEnvConnectionResult(undefined);
        setIsEditingEnv(false);
      } finally {
        setSavingEnv(false);
      }
    }, [
      envRows,
      isApiBilling,
      onEnvChange,
      onProviderPresetChange,
      savingEnv,
      selectedEnvPreset,
      t,
    ]);

    const getEnvConnectionResultText = useCallback(
      (result: EnvConnectionResult) => {
        if (result.ok) {
          return result.responseTimeMs === undefined
            ? t('heterogeneousStatus.env.checkSuccess')
            : t('heterogeneousStatus.env.checkSuccessWithLatency', {
                latency: result.responseTimeMs,
              });
        }

        return t('heterogeneousStatus.env.checkFailed', { message: result.message });
      },
      [t],
    );

    const checkEnvConnection = useCallback(async () => {
      if (!isApiBilling || checkingEnvConnection) return;

      const targetEnv = isEditingEnv ? rowsToEnv(envRows) : provider.env;
      const missingGroups = findMissingRequiredEnvGroups(targetEnv, selectedEnvPreset.required);

      if (missingGroups.length > 0) {
        setEnvConnectionResult({
          message: t('heterogeneousStatus.env.required', {
            keys: missingGroups.map(formatRequiredEnvGroup).join(', '),
          }),
          ok: false,
        });
        return;
      }

      try {
        setCheckingEnvConnection(true);
        setEnvConnectionResult(undefined);
        setEnvError(undefined);
        const result = await heterogeneousAgentService.checkClaudeCodeApiConnection({
          env: targetEnv ?? {},
        });
        setEnvConnectionResult(result);
      } catch (error) {
        setEnvConnectionResult({
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        });
      } finally {
        setCheckingEnvConnection(false);
      }
    }, [
      checkingEnvConnection,
      envRows,
      isApiBilling,
      isEditingEnv,
      provider.env,
      selectedEnvPreset.required,
      t,
    ]);

    const updateBillingType = useCallback(
      async (nextBillingType: HeterogeneousProviderBillingType) => {
        if (nextBillingType === billingType) return;

        await onBillingTypeChange?.(nextBillingType);
        setEnvError(undefined);
        setEnvConnectionResult(undefined);

        if (nextBillingType === 'api') {
          const presetId = inferClaudeCodeApiProviderPresetId(provider.env);
          const preset =
            getClaudeCodeApiProviderPreset(presetId) ?? DEFAULT_CLAUDE_CODE_API_PROVIDER_PRESET;
          setEnvPresetId(presetId);
          setEnvRows(
            ensureEnvRows(envToRows(provider.env), getDefaultRequiredEnvKeys(preset.required)),
          );
          setIsEditingEnv(true);
        } else {
          setEnvRows(envToRows(provider.env));
          setIsEditingEnv(false);
        }

        setBillingType(nextBillingType);
      },
      [billingType, onBillingTypeChange, provider.env],
    );

    const renderEnvConnectionResult = () => {
      if (!envConnectionResult) return null;

      return (
        <Text
          className={
            envConnectionResult.ok ? styles.envConnectionSuccess : styles.envConnectionError
          }
        >
          {getEnvConnectionResultText(envConnectionResult)}
        </Text>
      );
    };

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
                  disabled={savingCommand}
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

    const renderBillingType = () => {
      if (!isClaudeCode) return null;

      return (
        <div className={styles.detailRow}>
          <Text className={styles.detailLabel}>{t('heterogeneousStatus.billing.label')}</Text>
          <div className={styles.billingContent}>
            <Segmented
              value={billingType}
              options={[
                {
                  label: t('heterogeneousStatus.billing.subscription'),
                  value: 'subscription',
                },
                {
                  label: t('heterogeneousStatus.billing.api'),
                  value: 'api',
                },
              ]}
              onChange={(value) => {
                void updateBillingType(value as HeterogeneousProviderBillingType);
              }}
            />
            <Text className={styles.billingHint}>
              {t(
                isApiBilling
                  ? 'heterogeneousStatus.billing.apiDesc'
                  : 'heterogeneousStatus.billing.subscriptionDesc',
              )}
            </Text>
          </div>
        </div>
      );
    };

    const renderEnvEditor = () => {
      return (
        <div className={`${styles.detailRow} ${styles.envDetailRow}`}>
          <Text className={styles.detailLabel}>{t('heterogeneousStatus.env.label')}</Text>
          {isEditingEnv ? (
            <div className={styles.envEditor}>
              {isClaudeCode && isApiBilling && (
                <div className={styles.envToolbar}>
                  <Select
                    aria-label={t('heterogeneousStatus.env.preset')}
                    className={styles.envPresetSelect}
                    options={envPresetOptions}
                    value={envPresetId}
                    onChange={(value) => applyEnvPreset(value as string)}
                  />
                  <Text className={styles.billingHint}>
                    {t('heterogeneousStatus.env.presetHint')}
                  </Text>
                </div>
              )}
              {envRows.map((row) => (
                <div className={styles.envRow} key={row.id}>
                  <Input
                    className={styles.envInput}
                    disabled={savingEnv}
                    placeholder={t('heterogeneousStatus.env.keyPlaceholder')}
                    value={row.key}
                    onChange={(event) => {
                      updateEnvRow(row.id, 'key', event.target.value);
                    }}
                  />
                  <Input
                    className={styles.envInput}
                    disabled={savingEnv}
                    placeholder={t('heterogeneousStatus.env.valuePlaceholder')}
                    type={isSensitiveEnvKey(row.key) ? 'password' : 'text'}
                    value={row.value}
                    onChange={(event) => {
                      updateEnvRow(row.id, 'value', event.target.value);
                    }}
                  />
                  <ActionIcon
                    aria-label={t('heterogeneousStatus.env.remove')}
                    icon={Trash2Icon}
                    size="small"
                    onClick={() => removeEnvRow(row.id)}
                  />
                </div>
              ))}
              {envError && <Text className={styles.envValidation}>{envError}</Text>}
              {renderEnvConnectionResult()}
              <Flexbox horizontal align="center" justify="space-between">
                <ActionIcon
                  aria-label={t('heterogeneousStatus.env.add')}
                  icon={PlusIcon}
                  size="small"
                  title={t('heterogeneousStatus.env.add')}
                  onClick={addEnvRow}
                />
                <div className={styles.envActions}>
                  {isApiBilling && (
                    <ActionIcon
                      aria-label={t('heterogeneousStatus.env.checkConnection')}
                      disabled={checkingEnvConnection || savingEnv}
                      icon={RefreshCw}
                      loading={checkingEnvConnection}
                      size="small"
                      title={t('heterogeneousStatus.env.checkConnection')}
                      onClick={() => {
                        void checkEnvConnection();
                      }}
                    />
                  )}
                  <ActionIcon
                    aria-label={t('heterogeneousStatus.env.cancel')}
                    icon={XCircle}
                    size="small"
                    title={t('heterogeneousStatus.env.cancel')}
                    onClick={cancelEditingEnv}
                  />
                  <ActionIcon
                    aria-label={t('heterogeneousStatus.env.save')}
                    icon={SaveIcon}
                    loading={savingEnv}
                    size="small"
                    title={t('heterogeneousStatus.env.save')}
                    onClick={() => {
                      void commitEnv();
                    }}
                  />
                </div>
              </Flexbox>
            </div>
          ) : (
            <>
              <div className={styles.envSummary}>
                {envEntries.length > 0 ? (
                  <>
                    <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                      {t('heterogeneousStatus.env.count', { count: envEntries.length })}
                    </Tag>
                    <Text ellipsis className={styles.envSummaryText}>
                      {envNames.join(', ')}
                    </Text>
                    {renderEnvConnectionResult()}
                  </>
                ) : (
                  <>
                    <Text className={styles.envSummaryText}>
                      {t('heterogeneousStatus.env.empty')}
                    </Text>
                    {renderEnvConnectionResult()}
                  </>
                )}
              </div>
              {isApiBilling && (
                <Tooltip title={t('heterogeneousStatus.env.checkConnection')}>
                  <ActionIcon
                    aria-label={t('heterogeneousStatus.env.checkConnection')}
                    disabled={checkingEnvConnection}
                    icon={RefreshCw}
                    loading={checkingEnvConnection}
                    size="small"
                    onClick={() => {
                      void checkEnvConnection();
                    }}
                  />
                </Tooltip>
              )}
              <Tooltip title={t('heterogeneousStatus.env.edit')}>
                <ActionIcon
                  aria-label={t('heterogeneousStatus.env.edit')}
                  icon={PencilLine}
                  size="small"
                  onClick={startEditingEnv}
                />
              </Tooltip>
            </>
          )}
        </div>
      );
    };

    const renderAuth = () => {
      if (!isClaudeCode || isApiBilling || detecting || !status?.available || !auth?.loggedIn)
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
          {renderBillingType()}
          {renderEnvEditor()}
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
