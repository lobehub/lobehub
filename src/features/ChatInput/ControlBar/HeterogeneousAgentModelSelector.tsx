'use client';

import type {
  HeterogeneousAgentModel,
  HeterogeneousProviderConfig,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import { ActionIcon, Icon, Input, Tooltip } from '@lobehub/ui';
import {
  Button,
  DropdownMenuItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { isDesktop } from '@/const/version';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';
import { useElectronStore } from '@/store/electron';

import { useMenuContentLifecycle } from './useMenuContentLifecycle';

const DEDUPING_INTERVAL = 5 * 60 * 1000;

const styles = createStaticStyles(({ css }) => ({
  check: css`
    flex: none;
    color: ${cssVar.colorPrimary};
  `,
  container: css`
    display: flex;
    flex-direction: column;

    width: 340px;
    max-height: 430px;
    margin: -4px;
  `,
  empty: css`
    padding-block: 24px;
    padding-inline: 16px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  group: css`
    padding-block: 8px 3px;
    padding-inline: 10px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  item: css`
    display: flex;
    gap: 10px;
    align-items: center;

    width: calc(100% - 8px);
    min-height: 42px;
    margin-inline: 4px;
    padding-block: 5px;
    padding-inline: 8px;
    border-radius: 6px;
  `,
  itemBody: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  itemSubtitle: css`
    overflow: hidden;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemTitle: css`
    overflow: hidden;

    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-block-end: 4px;
  `,
  search: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 10px;
    border-block-end: 1px solid ${cssVar.colorSplit};
  `,
  spinning: css`
    animation: heterogeneous-agent-model-spin 0.8s linear infinite;

    @keyframes heterogeneous-agent-model-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  stale: css`
    color: ${cssVar.colorWarning};
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    height: 28px;
    padding-inline: 8px;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;
  `,
  triggerLabel: css`
    white-space: nowrap;
  `,
}));

const fingerprintConfig = (provider: HeterogeneousProviderConfig | undefined) => {
  const serialized = JSON.stringify({
    args: provider?.args ?? [],
    env: Object.entries(provider?.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getCatalogErrorKey = (name: string) => {
  switch (name) {
    case 'cli_not_found': {
      return 'heteroAgent.cliModel.cliNotFound';
    }
    case 'device_unavailable': {
      return 'heteroAgent.cliModel.targetUnavailable';
    }
    case 'timeout': {
      return 'heteroAgent.cliModel.timeout';
    }
    case 'unsupported_client': {
      return 'heteroAgent.cliModel.unsupportedClient';
    }
    default: {
      return 'heteroAgent.cliModel.error';
    }
  }
};

interface HeterogeneousAgentModelSelectorProps {
  agentId?: string;
  disabled: boolean;
  model: string;
  onSelect: (model: string) => void;
  permissionReason?: string;
  type: ListHeterogeneousAgentModelsParams['type'];
}

export const HeterogeneousAgentModelSelector = memo<HeterogeneousAgentModelSelectorProps>(
  ({ agentId, disabled, model, onSelect, permissionReason, type }) => {
    const { t } = useTranslation('chat');
    const agentName = type === 'pi' ? 'Pi' : type === 'qoder' ? 'Qoder' : 'OpenCode';
    const [search, setSearch] = useState('');
    const {
      contentActive,
      deferSelection: handleSelect,
      handleOpenChange,
      handleOpenChangeComplete: completeOpenChange,
      open,
    } = useMenuContentLifecycle(onSelect);
    const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
    const cwd = useEffectiveWorkingDirectory(agentId);
    const provider = agencyConfig?.heterogeneousProvider;
    useElectronStore((s) => s.useFetchGatewayDeviceInfo)();
    const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
    const executionTarget = resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      isHetero: true,
      workspaceScoped,
    });
    const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
      workspaceScoped,
    });
    const useLocalIpc = isDesktop && executionTarget === 'local';
    const rpcDeviceId = useLocalIpc ? undefined : targetDeviceId;
    const targetReady = useLocalIpc || (executionTarget === 'device' && !!rpcDeviceId);
    const currentModel =
      model && model !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION
        ? model
        : HETEROGENEOUS_AGENT_DEFAULT_SELECTION;
    const configFingerprint = fingerprintConfig(provider);

    const { data, error, isLoading, isValidating, mutate } = useSWR(
      contentActive && targetReady
        ? [
            'heterogeneous-agent-model-catalog',
            type,
            useLocalIpc ? 'local' : rpcDeviceId,
            cwd ?? '',
            provider?.command ?? '',
            configFingerprint,
          ]
        : null,
      async () => {
        const result = await heterogeneousAgentCatalogService.listModels({
          command: provider?.command,
          cwd,
          deviceId: rpcDeviceId,
          env: provider?.env,
          type,
        });
        if (result.status === 'error') {
          const catalogError = new Error(result.error.message);
          catalogError.name = result.error.code;
          throw catalogError;
        }
        return result;
      },
      {
        dedupingInterval: DEDUPING_INTERVAL,
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      },
    );

    const catalogModels = useMemo(() => data?.models ?? [], [data]);
    const selectedIsStale =
      currentModel !== HETEROGENEOUS_AGENT_DEFAULT_SELECTION &&
      !!data &&
      !catalogModels.some((item) => item.id === currentModel);
    const rows = useMemo(() => {
      const all: HeterogeneousAgentModel[] = selectedIsStale
        ? [
            {
              id: currentModel,
              modelId: currentModel.includes('/')
                ? currentModel.slice(currentModel.indexOf('/') + 1)
                : currentModel,
              providerId: t('heteroAgent.cliModel.saved'),
            },
            ...catalogModels,
          ]
        : catalogModels;
      const query = search.trim().toLowerCase();
      return query
        ? all.filter((item) =>
            [item.id, item.label, item.providerId, item.modelId].some(
              (value) => value && value.toLowerCase().includes(query),
            ),
          )
        : all;
    }, [catalogModels, currentModel, search, selectedIsStale, t]);
    const groups = useMemo(
      () =>
        rows.reduce<Record<string, HeterogeneousAgentModel[]>>((result, item) => {
          (result[item.providerId] ||= []).push(item);
          return result;
        }, {}),
      [rows],
    );

    const handleOpenChangeComplete = useCallback(
      (nextOpen: boolean) => {
        completeOpenChange(nextOpen);
        if (!nextOpen) setSearch('');
      },
      [completeOpenChange],
    );

    const trigger = (
      <div
        className={cx(styles.trigger, disabled && styles.triggerDisabled)}
        aria-label={t('heteroAgent.cliModel.ariaLabel', {
          name: agentName,
          model:
            currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
              ? t('heteroAgent.modelSelector.default')
              : currentModel,
        })}
      >
        <span className={styles.triggerLabel}>
          {currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
            ? t('heteroAgent.modelSelector.default')
            : currentModel}
        </span>
        <Icon icon={ChevronDownIcon} size={12} />
      </div>
    );

    if (disabled) {
      return (
        <Tooltip title={permissionReason}>
          <div>{trigger}</div>
        </Tooltip>
      );
    }

    return (
      <DropdownMenuRoot
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <DropdownMenuTrigger nativeButton={false}>{trigger}</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner placement="topLeft" sideOffset={8}>
            <DropdownMenuPopup>
              <div className={styles.container}>
                <div className={styles.search}>
                  <Input
                    autoFocus
                    placeholder={t('heteroAgent.cliModel.search')}
                    prefix={<Icon icon={SearchIcon} size={14} />}
                    size="small"
                    value={search}
                    variant="borderless"
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                  <ActionIcon
                    aria-label={t('heteroAgent.cliModel.reload')}
                    className={cx(isValidating && styles.spinning)}
                    disabled={!targetReady || isValidating}
                    icon={isValidating ? LoaderCircleIcon : RefreshCwIcon}
                    size="small"
                    title={t('heteroAgent.cliModel.reload')}
                    onClick={() => void mutate()}
                  />
                </div>
                <div className={styles.list}>
                  <DropdownMenuItem
                    className={styles.item}
                    onClick={() => handleSelect(HETEROGENEOUS_AGENT_DEFAULT_SELECTION)}
                  >
                    <div className={styles.itemBody}>
                      <div className={styles.itemTitle}>
                        {t('heteroAgent.modelSelector.default')}
                      </div>
                      <div className={styles.itemSubtitle}>
                        {t('heteroAgent.cliModel.defaultDesc', { name: agentName })}
                      </div>
                    </div>
                    {currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION && (
                      <Icon className={styles.check} icon={CheckIcon} size={14} />
                    )}
                  </DropdownMenuItem>

                  {isLoading && !data && (
                    <div className={styles.empty}>
                      {t('heteroAgent.cliModel.loading', { name: agentName })}
                    </div>
                  )}
                  {!targetReady && (
                    <div className={styles.empty}>
                      {t('heteroAgent.cliModel.targetUnavailable')}
                    </div>
                  )}
                  {error && (
                    <div className={styles.empty}>
                      {t(getCatalogErrorKey(error.name))}
                      <br />
                      <Button size="small" type="text" onClick={() => void mutate()}>
                        {t('heteroAgent.cliModel.retry')}
                      </Button>
                    </div>
                  )}
                  {data && rows.length === 0 && (
                    <div className={styles.empty}>
                      {search.trim()
                        ? t('heteroAgent.cliModel.noMatch')
                        : t('heteroAgent.cliModel.empty', { name: agentName })}
                    </div>
                  )}
                  {Object.entries(groups).map(([providerId, models]) => (
                    <div key={providerId}>
                      <div className={styles.group}>{providerId}</div>
                      {models.map((item) => (
                        <DropdownMenuItem
                          className={styles.item}
                          key={item.id}
                          onClick={() => handleSelect(item.id)}
                        >
                          <div className={styles.itemBody}>
                            <div className={styles.itemTitle}>{item.label ?? item.modelId}</div>
                            <div
                              className={cx(
                                styles.itemSubtitle,
                                selectedIsStale && item.id === currentModel && styles.stale,
                              )}
                            >
                              {item.id}
                              {selectedIsStale && item.id === currentModel
                                ? ` · ${t('heteroAgent.cliModel.stale')}`
                                : ''}
                            </div>
                          </div>
                          {item.id === currentModel && (
                            <Icon className={styles.check} icon={CheckIcon} size={14} />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

HeterogeneousAgentModelSelector.displayName = 'HeterogeneousAgentModelSelector';
