import {
  KLAVIS_SERVER_TYPES,
  LOBEHUB_SKILL_PROVIDERS,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
} from '@lobechat/const';
import type { ItemType } from '@lobehub/ui';
import { Avatar, Icon, Popover, SearchBar, stopPropagation, Tag, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import { Switch } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Package,
  Pin,
  Settings,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import DevModal from '@/features/PluginDevModal';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';
import KlavisServerItem from './KlavisServerItem';
import KlavisSkillIcon from './KlavisSkillIcon';
import LobehubSkillIcon from './LobehubSkillIcon';
import LobehubSkillServerItem from './LobehubSkillServerItem';
import MarketAgentSkillPopoverContent from './MarketAgentSkillPopoverContent';
import MarketSkillIcon from './MarketSkillIcon';
import ToolItem from './ToolItem';
import ToolItemDetailPopover from './ToolItemDetailPopover';

const SKILL_ICON_SIZE = 18;
const CLOSE_TOOL_DETAIL_POPOVER_EVENT = 'lobe-chat-tool-detail-popover-close';

const officialTag = (
  <Tooltip placement={'top'} title={'LobeHub'}>
    <Tag color={'success'} icon={<Icon icon={BadgeCheck} />} size={'small'} />
  </Tooltip>
);

type SkillPolicyMode = 'auto' | 'pinned';

interface SkillDeleteConfig {
  displayName: string;
  onDelete: () => Promise<void> | void;
}

interface SkillConfigureConfig {
  onConfigure: () => void;
}

type SkillMenuItem = NonNullable<ItemType> & {
  popoverContent?: ReactNode;
  searchText?: string;
};

const styles = createStaticStyles(({ css }) => ({
  activationGroupHeader: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
    padding-block: 4px;
  `,
  activationGroupChevron: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;

    color: ${cssVar.colorTextTertiary};
  `,
  activationGroupTitle: css`
    display: flex;
    gap: 7px;
    align-items: center;

    min-width: 0;
    min-height: 18px;
  `,
  activationGroupTitleBlock: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  activationGroupTitleText: css`
    overflow: hidden;

    min-width: 0;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  count: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  activationGroupActions: css`
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;
  `,
  switchWrap: css`
    display: inline-flex;
    flex: none;
    align-items: center;
  `,
  iconAuto: css`
    color: ${cssVar.colorInfo};
  `,
  iconDefault: css`
    color: ${cssVar.colorTextTertiary};
  `,
  iconPinned: css`
    color: ${cssVar.colorInfo};
  `,
  policyButton: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  deleteButton: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    line-height: 20px;
    color: ${cssVar.colorError};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorErrorBg};
    }
  `,
  deleteDivider: css`
    height: 1px;
    margin-block: 2px;
    margin-inline: 4px;
    background: ${cssVar.colorBorderSecondary};
  `,
  deleteIcon: css`
    color: ${cssVar.colorError};
  `,
  policyCheck: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;

    color: ${cssVar.colorInfo};
  `,
  policyItem: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    line-height: 20px;
    color: ${cssVar.colorText};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  policyItemIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
  `,
  policyPanel: css`
    min-width: 132px;
    padding: 4px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 0 15px 0 #00000008,
      0 2px 30px 0 #00000014;
  `,
  policyText: css`
    flex: 1;
    text-align: start;
  `,
  search: css`
    width: 100%;
  `,
  searchBox: css`
    display: flex;
    align-items: center;

    height: 36px;
    padding-inline: 10px;
    border-radius: 10px;

    background: ${cssVar.colorFillQuaternary};
  `,
  toolLabel: css`
    display: flex;
    flex: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  toolLabelText: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  toolRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    width: 100%;
    min-width: 0;
  `,
  typeTag: css`
    display: inline-flex;
    flex: none;
    align-items: center;

    padding-block: 1px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  statsFooter: css`
    display: flex;
    gap: 14px;
    align-items: center;
    width: 100%;
  `,
  statsSettingsButton: css`
    cursor: pointer;

    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    margin-inline-start: auto;
    padding: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.2s,
      background 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  statsItem: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const useControls = () => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const navigate = useNavigate();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [autoOpen, setAutoOpen] = useState(true);
  const [policyOpenId, setPolicyOpenId] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [autoModeLoading, setAutoModeLoading] = useState(false);
  const list = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const [
    uninstallPlugin,
    removeKlavisServer,
    deleteAgentSkill,
    installCustomPlugin,
    updateNewCustomPlugin,
    uninstallBuiltinTool,
  ] = useToolStore((s) => [
    s.uninstallCustomPlugin,
    s.removeKlavisServer,
    s.deleteAgentSkill,
    s.installCustomPlugin,
    s.updateNewCustomPlugin,
    s.uninstallBuiltinTool,
  ]);
  const [editingPluginId, setEditingPluginId] = useState<string | null>(null);
  const editingCustomPlugin = useToolStore(
    pluginSelectors.getCustomPluginById(editingPluginId ?? ''),
    isEqual,
  );
  const [checked, togglePlugin] = useAgentStore((s) => [
    agentByIdSelectors.getAgentPluginsById(agentId)(s),
    s.togglePlugin,
  ]);
  const checkedSet = useMemo(() => new Set(checked), [checked]);
  // In manual skill-activate mode, surface hidden builtin tools (web-browsing,
  // cloud-sandbox, knowledge-base, etc.) so users can explicitly enable/disable them.
  // In auto mode the activator handles those tools transparently, so they remain hidden.
  // NOTE: must read by `agentId` (not via the activeAgentId-based selector) so that
  // embedded / group-member chat inputs render the right agent's mode.
  const isManualSkillMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s) === 'manual',
  );
  const isAutoSkillMode = !isManualSkillMode;
  const builtinList = useToolStore(
    isManualSkillMode
      ? builtinToolSelectors.metaListIncludingHidden
      : builtinToolSelectors.metaList,
    isEqual,
  );
  const plugins = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  const updateSkillPolicy = useCallback(
    async (id: string, mode: SkillPolicyMode) => {
      const shouldPin = mode === 'pinned';
      if (checkedSet.has(id) === shouldPin) return;

      await togglePlugin(id, shouldPin);
    },
    [checkedSet, togglePlugin],
  );

  const openSkillPolicyMenu = useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
    }
    setPolicyOpenId(id);
  }, []);

  const renderPolicyMenu = useCallback(
    (id: string, deleteConfig?: SkillDeleteConfig, configureConfig?: SkillConfigureConfig) => {
      const mode: SkillPolicyMode = checkedSet.has(id) ? 'pinned' : 'auto';
      const renderCheck = (value: SkillPolicyMode) =>
        mode === value ? (
          <span className={cx(styles.policyCheck)}>
            <Icon icon={Check} size={14} />
          </span>
        ) : (
          <span className={cx(styles.policyCheck)} />
        );

      const renderPolicyItem = (value: SkillPolicyMode, icon: ReactNode) => (
        <button
          className={cx(styles.policyItem)}
          type="button"
          onClick={async (event) => {
            event.stopPropagation();
            setPolicyOpenId(null);
            await updateSkillPolicy(id, value);
          }}
        >
          <span className={cx(styles.policyItemIcon)}>{icon}</span>
          <span className={cx(styles.policyText)}>{t(`tools.activation.${value}`)}</span>
          {renderCheck(value)}
        </button>
      );

      const content = (
        <div
          className={cx(styles.policyPanel)}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {renderPolicyItem(
            'pinned',
            <Icon
              className={cx(mode === 'pinned' ? styles.iconPinned : styles.iconDefault)}
              icon={Pin}
              size={15}
            />,
          )}
          {renderPolicyItem(
            'auto',
            <Icon
              className={cx(mode === 'auto' ? styles.iconAuto : styles.iconDefault)}
              icon={Zap}
              size={15}
            />,
          )}
          {(configureConfig || deleteConfig) && <div className={cx(styles.deleteDivider)} />}
          {configureConfig && (
            <button
              className={cx(styles.policyItem)}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPolicyOpenId(null);
                configureConfig.onConfigure();
              }}
            >
              <span className={cx(styles.policyItemIcon)}>
                <Icon icon={Wrench} size={15} />
              </span>
              <span className={cx(styles.policyText)}>{t('tools.builtins.configure')}</span>
            </button>
          )}
          {deleteConfig && (
            <button
              className={cx(styles.deleteButton)}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPolicyOpenId(null);
                confirmModal({
                  content: t('tools.builtins.uninstallConfirm.desc', {
                    name: deleteConfig.displayName,
                  }),
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    await deleteConfig.onDelete();
                  },
                  title: t('tools.builtins.uninstallConfirm.title', {
                    name: deleteConfig.displayName,
                  }),
                });
              }}
            >
              <span className={cx(styles.policyItemIcon)}>
                <Icon className={cx(styles.deleteIcon)} icon={Trash2} size={15} />
              </span>
              <span className={cx(styles.policyText)}>{t('tools.builtins.uninstall')}</span>
            </button>
          )}
        </div>
      );

      return (
        <Popover
          arrow={false}
          content={content}
          open={policyOpenId === id}
          placement="rightTop"
          positionerProps={{ sideOffset: 8 }}
          styles={{ content: { padding: 0 } }}
          trigger="click"
          onOpenChange={(open) => (open ? openSkillPolicyMenu(id) : setPolicyOpenId(null))}
        >
          <button
            aria-label={t('tools.skillActivateMode.title')}
            className={cx(styles.policyButton)}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openSkillPolicyMenu(id);
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
            onPointerEnter={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event(CLOSE_TOOL_DETAIL_POPOVER_EVENT));
              }
            }}
          >
            <Icon icon={MoreHorizontal} size={15} />
          </button>
        </Popover>
      );
    },
    [checkedSet, openSkillPolicyMenu, policyOpenId, t, updateSkillPolicy],
  );

  const renderToolLabel = useCallback(
    (
      id: string,
      label: ReactNode,
      action: ReactNode,
      badge?: ReactNode,
      icon?: ReactNode,
      extraTag?: ReactNode,
    ) => (
      <span
        className={cx(styles.toolRow)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openSkillPolicyMenu(id);
        }}
      >
        <span className={cx(styles.toolLabel)}>
          {icon}
          <span className={cx(styles.toolLabelText)}>{label}</span>
          {extraTag}
          {badge && <span className={cx(styles.typeTag)}>{badge}</span>}
        </span>
        {action}
      </span>
    ),
    [openSkillPolicyMenu],
  );

  const createManagedSkillItem = useCallback(
    ({
      badge,
      configureConfig,
      deleteConfig,
      extraTag,
      icon,
      id,
      popoverContent,
      searchText,
      title,
    }: {
      badge?: ReactNode;
      configureConfig?: SkillConfigureConfig;
      deleteConfig?: SkillDeleteConfig;
      extraTag?: ReactNode;
      icon: ReactNode;
      id: string;
      popoverContent?: ReactNode;
      searchText?: string;
      title: ReactNode;
    }): SkillMenuItem =>
      ({
        closeOnClick: false,
        key: id,
        label: renderToolLabel(
          id,
          title,
          renderPolicyMenu(id, deleteConfig, configureConfig),
          badge,
          icon,
          extraTag,
        ),
        popoverContent,
        searchText: searchText || String(title || id),
      }) as SkillMenuItem,
    [renderPolicyMenu, renderToolLabel],
  );

  // Klavis-related state
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // LobeHub Skill related state
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  // Agent Skills related state
  const installedBuiltinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  const [
    useFetchUserKlavisServers,
    useFetchLobehubSkillConnections,
    useFetchUninstalledBuiltinTools,
    useFetchAgentSkills,
  ] = useToolStore((s) => [
    s.useFetchUserKlavisServers,
    s.useFetchLobehubSkillConnections,
    s.useFetchUninstalledBuiltinTools,
    s.useFetchAgentSkills,
  ]);

  useFetchInstalledPlugins();
  useFetchUninstalledBuiltinTools(true);
  useFetchAgentSkills(true);
  useCheckPluginsIsInstalled(plugins);

  // Load user's Klavis integrations via SWR (from database)
  useFetchUserKlavisServers(isKlavisEnabledInEnv);

  // Load user's LobeHub Skill connections via SWR
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);

  // Get connected server by identifier
  const getServerByName = useCallback(
    (identifier: string) => {
      return allKlavisServers.find((server) => server.identifier === identifier);
    },
    [allKlavisServers],
  );

  // Get all Klavis server type identifier sets (used for filtering builtinList)
  // Using KLAVIS_SERVER_TYPES instead of connected servers here, because we want to filter out all possible Klavis types
  const allKlavisTypeIdentifiers = useMemo(
    () => new Set(KLAVIS_SERVER_TYPES.map((type) => type.identifier)),
    [],
  );
  // Get all skill identifier sets (used for filtering builtinList)
  const allSkillIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    for (const s of installedBuiltinSkills) ids.add(s.identifier);
    for (const s of marketAgentSkills) ids.add(s.identifier);
    for (const s of userAgentSkills) ids.add(s.identifier);
    return ids;
  }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

  // Filter out Klavis tools and skills from builtinList (they will be displayed separately)
  const filteredBuiltinList = useMemo(() => {
    let list = builtinList;
    if (isKlavisEnabledInEnv) {
      list = list.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier));
    }
    return list.filter((item) => !allSkillIdentifiers.has(item.identifier));
  }, [builtinList, allKlavisTypeIdentifiers, isKlavisEnabledInEnv, allSkillIdentifiers]);

  // Get recommended Klavis skill IDs
  const recommendedKlavisIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Klavis).map((s) => s.id),
      ),
    [],
  );

  // Get recommended Lobehub skill IDs
  const recommendedLobehubIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Lobehub).map((s) => s.id),
      ),
    [],
  );

  // Get installed Klavis server IDs
  const installedKlavisIds = useMemo(
    () => new Set(allKlavisServers.map((s) => s.identifier)),
    [allKlavisServers],
  );

  // Get installed Lobehub skill IDs
  const installedLobehubIds = useMemo(
    () => new Set(allLobehubSkillServers.map((s) => s.identifier)),
    [allLobehubSkillServers],
  );

  // Klavis server list items - only show installed or recommended
  const klavisServerItems = useMemo(
    () =>
      isKlavisEnabledInEnv
        ? KLAVIS_SERVER_TYPES.filter(
            (type) =>
              installedKlavisIds.has(type.identifier) || recommendedKlavisIds.has(type.identifier),
          ).map((type) => {
            const server = getServerByName(type.identifier);
            const icon = (
              <KlavisSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />
            );
            const popoverContent = (
              <ToolItemDetailPopover
                icon={<KlavisSkillIcon icon={type.icon} label={type.label} size={36} />}
                identifier={type.identifier}
                sourceLabel={type.author}
                title={type.label}
                description={t(`tools.klavis.servers.${type.identifier}.description` as any, {
                  defaultValue: type.description,
                })}
              />
            );

            if (server?.status === KlavisServerStatus.CONNECTED) {
              return createManagedSkillItem({
                badge: <Icon icon={McpIcon} size={12} />,
                deleteConfig: {
                  displayName: type.label,
                  onDelete: () => removeKlavisServer(server.identifier),
                },
                extraTag: type.author === 'LobeHub' ? officialTag : undefined,
                icon,
                id: server.identifier,
                popoverContent,
                searchText: `${type.label} ${server.identifier}`,
                title: type.label,
              });
            }

            return {
              icon,
              key: type.identifier,
              label: (
                <KlavisServerItem
                  agentId={agentId}
                  identifier={type.identifier}
                  label={type.label}
                  server={server}
                  serverName={type.serverName}
                />
              ),
              popoverContent,
              searchText: type.label,
            };
          })
        : [],
    [
      isKlavisEnabledInEnv,
      installedKlavisIds,
      recommendedKlavisIds,
      agentId,
      t,
      createManagedSkillItem,
      getServerByName,
      removeKlavisServer,
    ],
  );

  // LobeHub Skill Provider list items - only show installed or recommended
  const lobehubSkillItems = useMemo(
    () =>
      isLobehubSkillEnabled
        ? LOBEHUB_SKILL_PROVIDERS.filter(
            (provider) =>
              installedLobehubIds.has(provider.id) || recommendedLobehubIds.has(provider.id),
          ).map((provider) => {
            const server = allLobehubSkillServers.find((s) => s.identifier === provider.id);
            const icon = (
              <LobehubSkillIcon
                icon={provider.icon}
                label={provider.label}
                size={SKILL_ICON_SIZE}
              />
            );
            const popoverContent = (
              <ToolItemDetailPopover
                icon={<LobehubSkillIcon icon={provider.icon} label={provider.label} size={36} />}
                identifier={provider.id}
                sourceLabel={provider.author}
                title={provider.label}
                description={t(`tools.lobehubSkill.providers.${provider.id}.description` as any, {
                  defaultValue: provider.description,
                })}
              />
            );

            if (server?.status === LobehubSkillStatus.CONNECTED || server?.isConnected) {
              return createManagedSkillItem({
                badge: <Icon icon={McpIcon} size={12} />,
                extraTag: provider.author === 'LobeHub' ? officialTag : undefined,
                icon,
                id: server.identifier,
                popoverContent,
                searchText: `${provider.label} ${server.identifier}`,
                title: provider.label,
              });
            }

            return {
              icon,
              key: provider.id, // Use provider.id as key, consistent with pluginId
              label: (
                <LobehubSkillServerItem
                  agentId={agentId}
                  label={provider.label}
                  provider={provider.id}
                />
              ),
              popoverContent,
              searchText: provider.label,
            };
          })
        : [],
    [
      isLobehubSkillEnabled,
      allLobehubSkillServers,
      installedLobehubIds,
      recommendedLobehubIds,
      agentId,
      t,
      createManagedSkillItem,
    ],
  );

  // Builtin tool list items (excluding Klavis and LobeHub Skill)
  const builtinItems = useMemo(
    () =>
      filteredBuiltinList.map((item) => {
        const title = t(`tools.builtins.${item.identifier}.title` as any, {
          defaultValue: item.meta?.title || item.identifier,
        });
        const icon = item.meta?.avatar ? (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              item.meta?.avatar ? (
                <Avatar
                  avatar={item.meta.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={Wrench} size={12} />,
          deleteConfig: {
            displayName: title,
            onDelete: () => uninstallBuiltinTool(item.identifier),
          },
          extraTag: officialTag,
          icon,
          id: item.identifier,
          popoverContent,
          searchText: `${title} ${item.identifier}`,
          title,
        });
      }),
    [filteredBuiltinList, t, createManagedSkillItem, uninstallBuiltinTool],
  );

  // Builtin Agent Skills list items (grouped under LobeHub)
  const builtinAgentSkillItems = useMemo(
    () =>
      installedBuiltinSkills.map((skill) => {
        const title = t(`tools.builtins.${skill.identifier}.title` as any, {
          defaultValue: skill.name,
        });
        const icon = skill.avatar ? (
          <Avatar avatar={skill.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <ToolItemDetailPopover
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            title={title}
            description={t(`tools.builtins.${skill.identifier}.description` as any, {
              defaultValue: skill.description,
            })}
            icon={
              skill.avatar ? (
                <Avatar
                  avatar={skill.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          extraTag: officialTag,
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${title} ${skill.identifier}`,
          title,
        });
      }),
    [installedBuiltinSkills, t, createManagedSkillItem],
  );

  // Market Agent Skills list items (grouped under Community)
  const marketAgentSkillItems = useMemo(
    () =>
      marketAgentSkills.map((skill) => {
        const icon = (
          <MarketSkillIcon identifier={skill.identifier} name={skill.name} size={SKILL_ICON_SIZE} />
        );
        const popoverContent = (
          <MarketAgentSkillPopoverContent
            description={skill.description}
            identifier={skill.identifier}
            name={skill.name}
            sourceLabel={t('skillStore.tabs.community')}
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          deleteConfig: {
            displayName: skill.name,
            onDelete: () => deleteAgentSkill(skill.id),
          },
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${skill.name} ${skill.identifier}`,
          title: skill.name,
        });
      }),
    [marketAgentSkills, t, createManagedSkillItem, deleteAgentSkill],
  );

  // User Agent Skills list items (grouped under Custom)
  const userAgentSkillItems = useMemo(
    () =>
      userAgentSkills.map((skill) => {
        const icon = <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />;
        const popoverContent = (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Icon icon={SkillsIcon} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={skill.name}
          />
        );

        return createManagedSkillItem({
          badge: <Icon icon={SkillsIcon} size={12} />,
          deleteConfig: {
            displayName: skill.name,
            onDelete: () => deleteAgentSkill(skill.id),
          },
          icon,
          id: skill.identifier,
          popoverContent,
          searchText: `${skill.name} ${skill.identifier}`,
          title: skill.name,
        });
      }),
    [userAgentSkills, t, createManagedSkillItem, deleteAgentSkill],
  );

  // Skills list items (including LobeHub Skill and Klavis)
  // Connected items listed first, deduplicated by key (LobeHub takes priority)
  const skillItems = useMemo(() => {
    // Deduplicate by key - LobeHub items take priority over Klavis
    const seenKeys = new Set<string>();
    const allItems: typeof lobehubSkillItems = [];

    // Add LobeHub items first (they take priority)
    for (const item of lobehubSkillItems) {
      if (!seenKeys.has(item.key as string)) {
        seenKeys.add(item.key as string);
        allItems.push(item);
      }
    }

    // Add Klavis items only if not already present
    for (const item of klavisServerItems) {
      if (!seenKeys.has(item.key as string)) {
        seenKeys.add(item.key as string);
        allItems.push(item);
      }
    }

    return allItems.sort((a, b) => {
      const isConnectedA =
        installedLobehubIds.has(a.key as string) || installedKlavisIds.has(a.key as string);
      const isConnectedB =
        installedLobehubIds.has(b.key as string) || installedKlavisIds.has(b.key as string);

      if (isConnectedA && !isConnectedB) return -1;
      if (!isConnectedA && isConnectedB) return 1;
      return 0;
    });
  }, [lobehubSkillItems, klavisServerItems, installedLobehubIds, installedKlavisIds]);

  // Distinguish community plugins and custom plugins
  const communityPlugins = list.filter((item) => item.type !== 'customPlugin');
  const customPlugins = list.filter((item) => item.type === 'customPlugin');

  // Function to map plugins to list items
  const mapPluginToItem = (item: (typeof list)[0]) => {
    const isMcp = item?.runtimeType === 'mcp';
    const hasRealAvatar = !!item?.avatar && item.avatar !== 'MCP_AVATAR';
    const isCustom = item.type === 'customPlugin';
    const icon = hasRealAvatar ? (
      <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
    ) : (
      <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
    );
    const popoverContent = (
      <ToolItemDetailPopover
        description={item.description}
        identifier={item.identifier}
        sourceLabel={isCustom ? t('skillStore.tabs.custom') : t('skillStore.tabs.community')}
        title={item.title}
        icon={
          hasRealAvatar ? (
            <Avatar
              avatar={item.avatar}
              shape={'square'}
              size={36}
              style={{ flex: 'none', marginInlineEnd: 0 }}
            />
          ) : (
            <Icon icon={McpIcon} size={36} />
          )
        }
      />
    );

    return createManagedSkillItem({
      badge: isMcp ? <Icon icon={McpIcon} size={12} /> : undefined,
      configureConfig: isCustom
        ? { onConfigure: () => setEditingPluginId(item.identifier) }
        : undefined,
      deleteConfig: {
        displayName: item.title ?? item.identifier,
        onDelete: () => uninstallPlugin(item.identifier),
      },
      extraTag: isCustom ? (
        <Tag color={'warning'} icon={<Icon icon={Package} />} size={'small'}>
          {t('store.customPlugin', { ns: 'plugin' })}
        </Tag>
      ) : item.author === 'LobeHub' ? (
        officialTag
      ) : undefined,
      icon,
      id: item.identifier,
      popoverContent,
      searchText: `${item.title} ${item.identifier}`,
      title: item.title,
    });
  };

  // Build LobeHub group children (including Builtin Agent Skills, builtin tools, and LobeHub Skill/Klavis)
  const lobehubGroupChildren: ItemType[] = [
    // 1. Builtin Agent Skills
    ...builtinAgentSkillItems,
    // 2. Builtin tools
    ...builtinItems,
    // 3. LobeHub Skill and Klavis (as builtin skills)
    ...skillItems,
  ];

  // Build Community group children (Market Agent Skills + community plugins)
  const communityGroupChildren: ItemType[] = [
    ...marketAgentSkillItems,
    ...communityPlugins.map(mapPluginToItem),
  ];

  // Build Custom group children (User Agent Skills + custom plugins)
  const customGroupChildren: ItemType[] = [
    ...userAgentSkillItems,
    ...customPlugins.map(mapPluginToItem),
  ];

  const normalizedSearchKeyword = searchKeyword.trim().toLowerCase();
  const allSkillItems = [
    ...lobehubGroupChildren,
    ...communityGroupChildren,
    ...customGroupChildren,
  ].filter(
    (item): item is SkillMenuItem =>
      Boolean(item) && (item as { type?: string }).type !== 'divider',
  );
  const filterBySearch = (items: SkillMenuItem[]) => {
    if (!normalizedSearchKeyword) return items;

    return items.filter((item) =>
      String(item.searchText || item.key || '')
        .toLowerCase()
        .includes(normalizedSearchKeyword),
    );
  };
  const allPinnedItems = allSkillItems.filter((item) => checkedSet.has(String(item.key)));
  const allAutoItems = allSkillItems.filter((item) => !checkedSet.has(String(item.key)));
  const pinnedItems = filterBySearch(allPinnedItems);
  const autoItems = filterBySearch(allAutoItems);

  const renderActivationGroupLabel = ({
    autoSwitch,
    icon,
    open,
    title,
    onToggle,
  }: {
    autoSwitch?: boolean;
    icon: ReactNode;
    open: boolean;
    title: string;
    onToggle: () => void;
  }) => (
    <div
      data-skill-activation-group
      className={cx(styles.activationGroupHeader)}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <div className={cx(styles.activationGroupTitleBlock)}>
        {icon}
        <span className={cx(styles.activationGroupTitleText)}>{title}</span>
      </div>
      <div className={cx(styles.activationGroupActions)}>
        {autoSwitch && (
          <span
            className={cx(styles.switchWrap)}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Switch
              checked={isAutoSkillMode}
              loading={autoModeLoading}
              size="small"
              onClick={(_, event) => event.stopPropagation()}
              onChange={async (checked, event) => {
                event?.stopPropagation?.();
                setAutoModeLoading(true);
                try {
                  await updateAgentChatConfig({
                    skillActivateMode: checked ? 'auto' : 'manual',
                  });
                } finally {
                  setAutoModeLoading(false);
                }
              }}
            />
          </span>
        )}
        <div className={cx(styles.activationGroupChevron)}>
          <Icon icon={open ? ChevronDown : ChevronRight} size={13} />
        </div>
      </div>
    </div>
  );

  const marketItems: ItemType[] = [
    {
      children: [],
      key: 'skill-search',
      label: (
        <div
          data-skill-menu-search
          className={cx(styles.search)}
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
        >
          <div className={cx(styles.searchBox)}>
            <SearchBar
              allowClear
              placeholder={t('tools.search')}
              size="small"
              style={{ flex: 1 }}
              value={searchKeyword}
              variant="borderless"
              onChange={(event) => setSearchKeyword(event.target.value)}
              onKeyDown={stopPropagation}
            />
          </div>
        </div>
      ),
      type: 'group' as const,
    },
    ...(pinnedItems.length > 0
      ? [
          {
            children: pinnedOpen ? pinnedItems : [],
            key: 'pinned',
            label: renderActivationGroupLabel({
              icon: <Icon icon={Pin} size={14} />,
              open: pinnedOpen,
              title: t('tools.activation.pinned'),
              onToggle: () => setPinnedOpen((open) => !open),
            }),
            type: 'group' as const,
          } as ItemType,
        ]
      : []),
    ...(pinnedItems.length > 0 && autoItems.length > 0
      ? [
          {
            key: 'skill-activation-divider',
            type: 'divider' as const,
          } as ItemType,
        ]
      : []),
    ...(autoItems.length > 0
      ? [
          {
            children: autoOpen ? autoItems : [],
            key: 'auto',
            label: renderActivationGroupLabel({
              autoSwitch: true,
              icon: <Icon icon={Zap} size={14} />,
              open: autoOpen,
              title: t('tools.activation.auto'),
              onToggle: () => setAutoOpen((open) => !open),
            }),
            type: 'group' as const,
          } as ItemType,
        ]
      : []),
    ...(allSkillItems.length > 0
      ? [
          {
            closeOnClick: false,
            key: 'skill-stats-footer',
            label: (
              <span data-fixed-menu-footer data-skill-stats>
                <div className={cx(styles.statsFooter)}>
                  <span className={cx(styles.statsItem)}>
                    <Icon icon={Pin} size={12} />
                    {allPinnedItems.length}
                  </span>
                  <span className={cx(styles.statsItem)}>
                    <Icon icon={Zap} size={12} />
                    {allAutoItems.length}
                  </span>
                  <Tooltip placement="top" title={t('tools.plugins.management')}>
                    <button
                      aria-label={t('tools.plugins.management')}
                      className={cx(styles.statsSettingsButton)}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate('/settings/skill');
                      }}
                    >
                      <Icon icon={Settings} size={14} />
                    </button>
                  </Tooltip>
                </div>
              </span>
            ),
          } as ItemType,
        ]
      : []),
  ];

  // Items for the installed tab - only show installed plugins
  const installedPluginItems: ItemType[] = useMemo(() => {
    const installedItems: ItemType[] = [];

    // Installed builtin tools
    const enabledBuiltinItems = filteredBuiltinList
      .filter((item) => checked.includes(item.identifier))
      .map((item) => ({
        icon: item.meta?.avatar ? (
          <Avatar avatar={item.meta.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={true}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              await togglePlugin(item.identifier);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              item.meta?.avatar ? (
                <Avatar
                  avatar={item.meta.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
            title={t(`tools.builtins.${item.identifier}.title` as any, {
              defaultValue: item.meta?.title || item.identifier,
            })}
          />
        ),
      }));

    // Connected Klavis servers
    const connectedKlavisItems = klavisServerItems.filter((item) =>
      checked.includes(item.key as string),
    );

    // Connected LobeHub Skill Providers
    const connectedLobehubSkillItems = lobehubSkillItems.filter((item) =>
      checked.includes(item.key as string),
    );

    // Merge enabled LobeHub Skill and Klavis (as builtin skills)
    const enabledSkillItems = [...connectedLobehubSkillItems, ...connectedKlavisItems];

    // Enabled Builtin Agent Skills
    const enabledBuiltinAgentSkillItems = installedBuiltinSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: skill.avatar ? (
          <Avatar avatar={skill.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              await togglePlugin(skill.identifier);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${skill.identifier}.description` as any, {
              defaultValue: skill.description,
            })}
            icon={
              skill.avatar ? (
                <Avatar
                  avatar={skill.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
            title={t(`tools.builtins.${skill.identifier}.title` as any, {
              defaultValue: skill.name,
            })}
          />
        ),
      }));

    // Build builtin tools group children (including Builtin Agent Skills, builtin tools, and LobeHub Skill/Klavis)
    const allBuiltinItems: ItemType[] = [
      // 1. Builtin Agent Skills
      ...enabledBuiltinAgentSkillItems,
      // 2. Builtin tools
      ...enabledBuiltinItems,
      // 3. divider (if there are builtin tools and skill items)
      ...(enabledBuiltinItems.length > 0 && enabledSkillItems.length > 0
        ? [{ key: 'installed-divider-builtin-skill', type: 'divider' as const }]
        : []),
      // 4. LobeHub Skill and Klavis
      ...enabledSkillItems,
    ];

    if (allBuiltinItems.length > 0) {
      installedItems.push({
        children: allBuiltinItems,
        key: 'installed-lobehub',
        label: t('skillStore.tabs.lobehub'),
        type: 'group',
      });
    }

    // Enabled community plugins
    const enabledCommunityPlugins = communityPlugins
      .filter((item) => checked.includes(item.identifier))
      .map((item) => {
        const hasRealAvatar = !!item?.avatar && item.avatar !== 'MCP_AVATAR';
        return {
          icon: hasRealAvatar ? (
            <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ) : (
            <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                await togglePlugin(item.identifier);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={item.description}
              identifier={item.identifier}
              sourceLabel={t('skillStore.tabs.community')}
              title={item.title}
              icon={
                hasRealAvatar ? (
                  <Avatar
                    avatar={item.avatar}
                    shape={'square'}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                ) : (
                  <Icon icon={McpIcon} size={36} />
                )
              }
            />
          ),
        };
      });

    // Enabled custom plugins
    const enabledCustomPlugins = customPlugins
      .filter((item) => checked.includes(item.identifier))
      .map((item) => {
        const hasRealAvatar = !!item?.avatar && item.avatar !== 'MCP_AVATAR';
        return {
          icon: hasRealAvatar ? (
            <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ) : (
            <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                await togglePlugin(item.identifier);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={item.description}
              identifier={item.identifier}
              sourceLabel={t('skillStore.tabs.custom')}
              title={item.title}
              icon={
                hasRealAvatar ? (
                  <Avatar
                    avatar={item.avatar}
                    shape={'square'}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                ) : (
                  <Icon icon={McpIcon} size={36} />
                )
              }
            />
          ),
        };
      });

    // Enabled Market Agent Skills
    const enabledMarketAgentSkillItems = marketAgentSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: (
          <MarketSkillIcon identifier={skill.identifier} name={skill.name} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              await togglePlugin(skill.identifier);
            }}
          />
        ),
        popoverContent: (
          <MarketAgentSkillPopoverContent
            description={skill.description}
            identifier={skill.identifier}
            name={skill.name}
            sourceLabel={t('skillStore.tabs.community')}
          />
        ),
      }));

    // Community group (Market Agent Skills + community plugins)
    const allCommunityItems = [...enabledMarketAgentSkillItems, ...enabledCommunityPlugins];
    if (allCommunityItems.length > 0) {
      installedItems.push({
        children: allCommunityItems,
        key: 'installed-community',
        label: t('skillStore.tabs.community'),
        type: 'group',
      });
    }

    // Enabled User Agent Skills
    const enabledUserAgentSkillItems = userAgentSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />,
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              await togglePlugin(skill.identifier);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Icon icon={SkillsIcon} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={skill.name}
          />
        ),
      }));

    // Custom group (User Agent Skills + custom plugins)
    const allCustomItems = [...enabledUserAgentSkillItems, ...enabledCustomPlugins];
    if (allCustomItems.length > 0) {
      installedItems.push({
        children: allCustomItems,
        key: 'installed-custom',
        label: t('skillStore.tabs.custom'),
        type: 'group',
      });
    }

    return installedItems;
  }, [
    filteredBuiltinList,
    installedBuiltinSkills,
    marketAgentSkills,
    userAgentSkills,
    communityPlugins,
    customPlugins,
    klavisServerItems,
    lobehubSkillItems,
    checked,
    togglePlugin,
    t,
  ]);

  const editPluginDrawer = (
    <DevModal
      mode={'edit'}
      open={!!editingPluginId}
      value={editingCustomPlugin}
      onValueChange={updateNewCustomPlugin}
      onDelete={() => {
        if (editingPluginId) uninstallPlugin(editingPluginId);
        setEditingPluginId(null);
      }}
      onOpenChange={(open) => {
        if (!open) setEditingPluginId(null);
      }}
      onSave={async (devPlugin) => {
        await installCustomPlugin(devPlugin);
        setEditingPluginId(null);
      }}
    />
  );

  return {
    autoCount: allAutoItems.length,
    editPluginDrawer,
    installedPluginItems,
    marketItems,
    pinnedCount: allPinnedItems.length,
  };
};
