'use client';

import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import type { HeterogeneousAgentModel, ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import { ActionIcon, Icon, Input, Tooltip } from '@lobehub/ui';
import {
  Button,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuHeader,
  DropdownMenuItem,
  DropdownMenuItemContent,
  DropdownMenuItemDesc,
  DropdownMenuItemExtra,
  DropdownMenuItemLabel,
  DropdownMenuItemLabelGroup,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuScrollViewport,
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

import { useMenuContentLifecycle } from '../useMenuContentLifecycle';
import { useModelCatalog } from './useModelCatalog';

const styles = createStaticStyles(({ css }) => ({
  check: css`
    flex: none;
    color: ${cssVar.colorPrimary};
  `,
  empty: css`
    padding-block: 24px;
    padding-inline: 16px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  item: css`
    min-height: 42px;
  `,
  popup: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 340px;
    max-height: 430px;
  `,
  search: css`
    display: flex;
    gap: 6px;
    align-items: center;
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

    max-width: 150px;

    font-family: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
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

interface ModelCatalogSelectorProps {
  agentId?: string;
  disabled: boolean;
  model: string;
  onSelect: (model: string) => void;
  permissionReason?: string;
  type: ListHeterogeneousAgentModelsParams['type'];
  variant?: 'standalone' | 'submenu';
}

export const ModelCatalogSelector = memo<ModelCatalogSelectorProps>(
  ({ agentId, disabled, model, onSelect, permissionReason, type, variant = 'standalone' }) => {
    const { t } = useTranslation('chat');
    const agentName = getHeterogeneousTypeLabel(type) ?? type;
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
    const { data, error, isLoading, isValidating, mutate } = useModelCatalog({
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
    const closeOnSelect = variant !== 'submenu';
    const menu = (
      <>
        <DropdownMenuHeader className={styles.search}>
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
        </DropdownMenuHeader>
        <DropdownMenuScrollViewport>
          <DropdownMenuItem
            className={styles.item}
            closeOnClick={closeOnSelect}
            onClick={() => handleModelSelect(HETEROGENEOUS_AGENT_DEFAULT_SELECTION)}
          >
            <DropdownMenuItemContent>
              <DropdownMenuItemLabelGroup>
                <DropdownMenuItemLabel>
                  {t('heteroAgent.modelSelector.default')}
                </DropdownMenuItemLabel>
                <DropdownMenuItemDesc>
                  {t('heteroAgent.cliModel.defaultDesc', { name: agentName })}
                </DropdownMenuItemDesc>
              </DropdownMenuItemLabelGroup>
              {currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION && (
                <DropdownMenuItemExtra className={styles.check}>
                  <Icon icon={CheckIcon} size={14} />
                </DropdownMenuItemExtra>
              )}
            </DropdownMenuItemContent>
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
            <DropdownMenuGroup key={providerId}>
              <DropdownMenuGroupLabel>{providerId}</DropdownMenuGroupLabel>
              {models.map((item) => {
                const isStale = selectedIsStale && item.id === currentModel;

                return (
                  <DropdownMenuItem
                    className={styles.item}
                    closeOnClick={closeOnSelect}
                    key={item.id}
                    onClick={() => handleModelSelect(item.id)}
                  >
                    <DropdownMenuItemContent>
                      <DropdownMenuItemLabelGroup>
                        <DropdownMenuItemLabel>{item.label ?? item.modelId}</DropdownMenuItemLabel>
                        <DropdownMenuItemDesc className={cx(isStale && styles.stale)}>
                          {item.id}
                          {isStale ? ` · ${t('heteroAgent.cliModel.stale')}` : ''}
                        </DropdownMenuItemDesc>
                      </DropdownMenuItemLabelGroup>
                      {item.id === currentModel && (
                        <DropdownMenuItemExtra className={styles.check}>
                          <Icon icon={CheckIcon} size={14} />
                        </DropdownMenuItemExtra>
                      )}
                    </DropdownMenuItemContent>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuScrollViewport>
      </>
    );

    if (variant === 'submenu') {
      return (
        <DropdownMenuSubmenuRoot
          open={open}
          onOpenChange={handleOpenChange}
          onOpenChangeComplete={handleOpenChangeComplete}
        >
          <DropdownMenuSubmenuTrigger
            label={t('heteroAgent.modelSelector.model')}
            openOnHover={false}
          >
            <DropdownMenuItemContent>
              <DropdownMenuItemLabel>{t('heteroAgent.modelSelector.model')}</DropdownMenuItemLabel>
              <DropdownMenuItemExtra className={styles.submenuMeta}>
                {currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
                  ? t('heteroAgent.modelSelector.default')
                  : currentModel}
              </DropdownMenuItemExtra>
              <DropdownMenuSubmenuArrow>
                <Icon icon={ChevronRightIcon} size={12} />
              </DropdownMenuSubmenuArrow>
            </DropdownMenuItemContent>
          </DropdownMenuSubmenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner alignOffset={-4} anchor={null} placement="right" sideOffset={8}>
              <DropdownMenuPopup className={styles.popup} data-has-header="">
                {menu}
              </DropdownMenuPopup>
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
            <DropdownMenuPopup className={styles.popup} data-has-header="">
              {menu}
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

ModelCatalogSelector.displayName = 'ModelCatalogSelector';
