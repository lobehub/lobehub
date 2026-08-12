'use client';

import type { HeterogeneousAgentModel, ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import { ActionIcon, Icon, Input, Tooltip } from '@lobehub/ui';
import {
  Button,
  DropdownMenuItem,
  DropdownMenuItemContent,
  DropdownMenuItemExtra,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuSubmenuArrow,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useHeterogeneousAgentModelCatalog } from './useHeterogeneousAgentModelCatalog';
import { useMenuContentLifecycle } from './useMenuContentLifecycle';

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
  submenuMeta: css`
    overflow: hidden;
    display: inline-flex;
    flex: none;
    align-items: center;

    min-width: 0;
    max-width: 150px;
    padding-inline-start: 16px;

    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
  submenuMetaLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  submenuTrigger: css`
    min-height: 36px;
    padding-inline: 10px;
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
  variant?: 'standalone' | 'submenu';
}

export const HeterogeneousAgentModelSelector = memo<HeterogeneousAgentModelSelectorProps>(
  ({ agentId, disabled, model, onSelect, permissionReason, type, variant = 'standalone' }) => {
    const { t } = useTranslation('chat');
    const agentName = type === 'pi' ? 'Pi' : type === 'qoder' ? 'Qoder' : 'OpenCode';
    const [search, setSearch] = useState('');
    const {
      deferSelection: handleSelect,
      handleOpenChange,
      handleOpenChangeComplete: completeOpenChange,
      open,
    } = useMenuContentLifecycle(onSelect);
    const { agencyConfig, isPreferenceLoading, workspaceScoped } =
      useEffectiveAgencyConfig(agentId);
    const isLogin = useUserStore(authSelectors.isLogin);
    const { isLoading: isDeviceListLoading } = useDeviceStore((s) => s.useFetchDevices)(
      isLogin || isDesktop,
    );
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
    const { data, error, isLoading, isValidating, mutate } = useHeterogeneousAgentModelCatalog({
      cwd,
      deviceId: rpcDeviceId,
      isDeviceListLoading,
      isPreferenceLoading,
      open,
      provider,
      targetReady,
      type,
    });

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

    const handleModelSelect = variant === 'submenu' ? onSelect : handleSelect;
    const menu = (
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
            onClick={() => handleModelSelect(HETEROGENEOUS_AGENT_DEFAULT_SELECTION)}
          >
            <div className={styles.itemBody}>
              <div className={styles.itemTitle}>{t('heteroAgent.modelSelector.default')}</div>
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
            <div className={styles.empty}>{t('heteroAgent.cliModel.targetUnavailable')}</div>
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
                  onClick={() => handleModelSelect(item.id)}
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
    );

    if (variant === 'submenu') {
      return (
        <DropdownMenuSubmenuRoot
          open={open}
          onOpenChange={handleOpenChange}
          onOpenChangeComplete={handleOpenChangeComplete}
        >
          <DropdownMenuSubmenuTrigger
            className={styles.submenuTrigger}
            label={t('heteroAgent.modelSelector.model')}
            openOnHover={false}
          >
            <DropdownMenuItemContent>
              <DropdownMenuItemLabel>{t('heteroAgent.modelSelector.model')}</DropdownMenuItemLabel>
              <DropdownMenuItemExtra className={styles.submenuMeta}>
                <span className={styles.submenuMetaLabel}>
                  {currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
                    ? t('heteroAgent.modelSelector.default')
                    : currentModel}
                </span>
              </DropdownMenuItemExtra>
              <DropdownMenuSubmenuArrow>
                <Icon icon={ChevronRightIcon} size={12} />
              </DropdownMenuSubmenuArrow>
            </DropdownMenuItemContent>
          </DropdownMenuSubmenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner alignOffset={-4} anchor={null} placement="right" sideOffset={8}>
              <DropdownMenuPopup>{menu}</DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuSubmenuRoot>
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
            <DropdownMenuPopup>{menu}</DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

HeterogeneousAgentModelSelector.displayName = 'HeterogeneousAgentModelSelector';
