'use client';

import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { HETEROGENEOUS_AGENT_DEFAULT_SELECTION } from '@lobechat/types';
import {
  ActionIcon,
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
  Icon,
  Input,
  Tooltip,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useTopicId } from '../../hooks/useTopicId';
import { useMenuContentLifecycle } from '../useMenuContentLifecycle';
import { useModelCatalog } from './useModelCatalog';
import { useModelCatalogView } from './useModelCatalogView';

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } });

const styles = stylex.create({
  check: { flex: 'none', color: cssVar.colorPrimary },
  empty: {
    paddingBlock: '24px',
    paddingInline: '16px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  groupLabel: { textTransform: 'none', letterSpacing: 'normal' },
  item: { minHeight: '42px' },
  popup: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '340px',
    maxHeight: '430px',
  },
  search: { display: 'flex', gap: '8px', alignItems: 'center', paddingBlock: '10px' },
  spinning: {
    animationName: spin,
    animationDuration: '0.8s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  stale: { color: cssVar.colorWarning },
  submenuMeta: {
    overflow: 'hidden',
    maxWidth: '150px',
    fontFamily: 'inherit',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    height: '28px',
    paddingInline: '8px',
    borderRadius: '6px',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  triggerDisabled: { cursor: 'not-allowed', opacity: 0.5 },
  triggerLabel: { whiteSpace: 'nowrap' },
});

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
    case 'unsupported_configuration': {
      return 'heteroAgent.cliModel.unsupportedConfiguration';
    }
    default: {
      return 'heteroAgent.cliModel.error';
    }
  }
};

interface ModelCatalogSelectorProps {
  agentId?: string;
  /** Secondary line under the submenu label, e.g. where the current model comes from. */
  desc?: string;
  disabled: boolean;
  model: string;
  onSelect: (model: string) => void;
  permissionReason?: string;
  type: ListHeterogeneousAgentModelsParams['type'];
  variant?: 'standalone' | 'submenu';
}

export const ModelCatalogSelector = memo<ModelCatalogSelectorProps>(
  ({
    agentId,
    desc,
    disabled,
    model,
    onSelect,
    permissionReason,
    type,
    variant = 'standalone',
  }) => {
    const { t } = useTranslation('chat');
    const agentName = getHeterogeneousTypeLabel(type) ?? type;
    const [search, setSearch] = useState('');
    const {
      deferSelection: handleSelect,
      handleOpenChange,
      handleOpenChangeComplete: completeOpenChange,
      open,
    } = useMenuContentLifecycle(onSelect);
    const topicId = useTopicId();
    const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(
      agentId,
      { topicId },
    );
    const isLogin = useUserStore(authSelectors.isLogin);
    useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);
    const isDeviceListLoading = !useDeviceStore(deviceSelectors.isDeviceListLoaded);
    // Let the execution host choose its default; this desktop's fallback may not exist remotely.
    const cwd = useEffectiveWorkingDirectory(agentId, { homeFallback: false, topicId });
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

    const { groups, rows, selectedIsStale } = useModelCatalogView({
      currentModel,
      data,
      savedLabel: t('heteroAgent.cliModel.saved'),
      search,
    });

    const handleOpenChangeComplete = useCallback(
      (nextOpen: boolean) => {
        completeOpenChange(nextOpen);
        if (!nextOpen) setSearch('');
      },
      [completeOpenChange],
    );

    const trigger = (
      <div
        {...stylex.props(styles.trigger, disabled && styles.triggerDisabled)}
        aria-label={t('heteroAgent.cliModel.ariaLabel', {
          name: agentName,
          model:
            currentModel === HETEROGENEOUS_AGENT_DEFAULT_SELECTION
              ? t('heteroAgent.modelSelector.default')
              : currentModel,
        })}
      >
        <span {...stylex.props(styles.triggerLabel)}>
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
        <DropdownMenuHeader className={stylex.props(styles.search).className}>
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
            className={isValidating ? stylex.props(styles.spinning).className : undefined}
            disabled={!targetReady || isValidating}
            icon={isValidating ? LoaderCircleIcon : RefreshCwIcon}
            size="small"
            title={t('heteroAgent.cliModel.reload')}
            onClick={() => void mutate()}
          />
        </DropdownMenuHeader>
        <DropdownMenuScrollViewport>
          <DropdownMenuItem
            className={stylex.props(styles.item).className}
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
                <DropdownMenuItemExtra className={stylex.props(styles.check).className}>
                  <Icon icon={CheckIcon} size={14} />
                </DropdownMenuItemExtra>
              )}
            </DropdownMenuItemContent>
          </DropdownMenuItem>

          {isLoading && !data && (
            <div {...stylex.props(styles.empty)}>
              {t('heteroAgent.cliModel.loading', { name: agentName })}
            </div>
          )}
          {!targetReady && (
            <div {...stylex.props(styles.empty)}>{t('heteroAgent.cliModel.targetUnavailable')}</div>
          )}
          {error && (
            <div {...stylex.props(styles.empty)}>
              {t(getCatalogErrorKey(error.name))}
              <br />
              <Button size="small" type="text" onClick={() => void mutate()}>
                {t('heteroAgent.cliModel.retry')}
              </Button>
            </div>
          )}
          {data && !error && rows.length === 0 && (
            <div {...stylex.props(styles.empty)}>
              {search.trim()
                ? t('heteroAgent.cliModel.noMatch')
                : t('heteroAgent.cliModel.empty', { name: agentName })}
            </div>
          )}
          {Object.entries(groups).map(([providerId, models]) => (
            <DropdownMenuGroup key={providerId}>
              <DropdownMenuGroupLabel className={stylex.props(styles.groupLabel).className}>
                {getHeterogeneousTypeLabel(providerId) ?? providerId}
              </DropdownMenuGroupLabel>
              {models.map((item) => {
                const isStale = selectedIsStale && item.id === currentModel;

                return (
                  <DropdownMenuItem
                    className={stylex.props(styles.item).className}
                    closeOnClick={closeOnSelect}
                    key={item.id}
                    onClick={() => handleModelSelect(item.id)}
                  >
                    <DropdownMenuItemContent>
                      <DropdownMenuItemLabelGroup>
                        <DropdownMenuItemLabel>{item.label ?? item.modelId}</DropdownMenuItemLabel>
                        <DropdownMenuItemDesc
                          className={isStale ? stylex.props(styles.stale).className : undefined}
                        >
                          {item.id}
                          {isStale ? ` · ${t('heteroAgent.cliModel.stale')}` : ''}
                        </DropdownMenuItemDesc>
                      </DropdownMenuItemLabelGroup>
                      {item.id === currentModel && (
                        <DropdownMenuItemExtra className={stylex.props(styles.check).className}>
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
              {desc ? (
                <DropdownMenuItemLabelGroup>
                  <DropdownMenuItemLabel>
                    {t('heteroAgent.modelSelector.model')}
                  </DropdownMenuItemLabel>
                  <DropdownMenuItemDesc>{desc}</DropdownMenuItemDesc>
                </DropdownMenuItemLabelGroup>
              ) : (
                <DropdownMenuItemLabel>
                  {t('heteroAgent.modelSelector.model')}
                </DropdownMenuItemLabel>
              )}
              <DropdownMenuItemExtra className={stylex.props(styles.submenuMeta).className}>
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
              <DropdownMenuPopup
                className={stylex.props(styles.popup).className}
                data-has-header=""
              >
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
            <DropdownMenuPopup className={stylex.props(styles.popup).className} data-has-header="">
              {menu}
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    );
  },
);

ModelCatalogSelector.displayName = 'ModelCatalogSelector';
