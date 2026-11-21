'use client';

import { hasCallableMcpEndpoint } from '@lobechat/const';
import type { ConnectorVisibility } from '@lobechat/types';
import { Button, Center, Empty } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon, ChevronRightIcon, LockIcon, SearchX } from 'lucide-react';
import type React from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { SkeletonList } from '@/components/Skeleton/NavPanel/List';
import { CONNECTOR_PAGE_IDS, hasConnectorPage } from '@/features/Integrations/connectorPage';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import {
  connectorSelectors,
  isInConnectorTab,
  isIntegrationInConnectorTab,
} from '@/store/tool/slices/connector';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { densityTokens } from '@/styles/density.stylex';
import { type LobeToolType } from '@/types/tool/tool';

import AgentConnectorItem from './AgentConnectorItem';
import AgentSkillItem from './AgentSkillItem';
import ComposioSkillItem from './ComposioSkillItem';
import { AccountsNeedReauth, countAccountsNeedingReauth } from './ConnectorRowFeedback';
import {
  buildIntegrationItems,
  countConnectorTabItems,
  getVisibleSectionItems,
  type IntegrationItem,
  isIntegrationConnected,
  isSectionExpandable,
  matchesConnectorKeyword,
  matchesIntegrationKeyword,
  partitionByInstalled,
} from './connectorSections';
import LobehubSkillItem from './LobehubSkillItem';
import McpSkillItem from './McpSkillItem';
import PageSectionHeading from './PageSectionHeading';
import { privateTabState } from './privateTabState';
import type { ToolDetailType } from './SkillDetail';
import { useSkillListVariant } from './SkillListRow';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '2px' },
  sectionHeader: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    paddingBlockStart: densityTokens['--lobe-density-content-gap'],
    paddingBlockEnd: '4px',
    paddingInline: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  // Page groups (the Codex Plugins catalog): a 16px heading, then a
  // two-column catalog of borderless rows; groups are separated by 32px of
  // whitespace, not rules. The rows' 12px inset plus the 16px column gap
  // leave ~40px between the two columns' content.
  // 12px + the row's 14px tile inset ≈ the Codex 24px from heading to icon tile.
  pageSection: { display: 'flex', flexDirection: 'column', gap: '12px' },
  pageSections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    paddingBlockStart: '24px',
  },
  pageGrid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.lg]: 'minmax(0, 1fr)' },
    columnGap: '16px',
    rowGap: '4px',
  },
});

/** What the page header can drive in the list: re-fetch every source it shows. */
export interface SkillListHeaderContext {
  onRefresh: () => void;
  refreshing: boolean;
}

export type SkillViewMode = 'connector' | 'mcp' | 'skill';

interface SkillListProps {
  /** Page search: filters every group by name, identifier and description. */
  keyword?: string;
  onClearKeyword?: () => void;
  onDeleteSelected?: () => void;
  onSelect?: (identifier: string, type: ToolDetailType) => void;
  /** Page header above the groups. */
  renderHeader?: (context: SkillListHeaderContext) => React.ReactNode;
  selectedIdentifier?: string;
  viewMode?: SkillViewMode;
  /**
   * Workspace connector tab: `public` lists the shared pool (every catalog
   * section); `private` lists only the caller's private connectors. Unset
   * outside a workspace.
   */
  visibility?: ConnectorVisibility;
}

const SkillList = memo<SkillListProps>(
  ({
    keyword,
    onClearKeyword,
    onSelect,
    onDeleteSelected,
    renderHeader,
    selectedIdentifier,
    viewMode = 'connector',
    visibility,
  }) => {
    const { t } = useTranslation('setting');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [refreshing, setRefreshing] = useState(false);
    const isPage = useSkillListVariant() === 'page';

    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
    const { showMarket } = useServerConfigStore(featureFlagsSelectors);
    const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
    const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
    const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
    const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
    const allCustomConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);
    const allMarketplaceConnectors = useToolStore(
      connectorSelectors.marketplaceMcpConnectors,
      isEqual,
    );
    const isConnectorsInit = useToolStore((s) => s.isConnectorsInit);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    // The Private tab reads only this list: keep its load's failure for Retry
    const connectorsSWR = useToolStore((s) => s.useFetchConnectors)(true);
    const allAgentBoundConnectors = useToolStore(connectorSelectors.agentBoundConnectors, isEqual);
    // What an OAuth integration's tab is decided by: its rows' visibility, and
    // which of them holds the account its actions act on
    const connectorTabRows = useToolStore(
      (s) =>
        connectorSelectors.connectorList(s).map(({ identifier, metadata, visibility }) => ({
          identifier,
          metadata: metadata?.composio ? { composio: metadata.composio } : null,
          visibility,
        })),
      isEqual,
    );
    const isAgentBoundInit = useToolStore((s) => s.isAgentBoundInit);
    const fetchAgentBoundConnectors = useToolStore((s) => s.fetchAgentBoundConnectors);
    const [useFetchLobehubSkillConnections, useFetchUserComposioConnections, useFetchAgentSkills] =
      useToolStore((s) => [
        s.useFetchLobehubSkillConnections,
        s.useFetchUserComposioConnections,
        s.useFetchAgentSkills,
      ]);

    useFetchInstalledPlugins();
    // Keep each SWR handle so a failed skill fetch surfaces error + Retry instead
    // of a fake-empty list (each hook syncs into the store only on success —
    //
    const isConnectorView = viewMode !== 'skill';
    const lobehubSkillsSWR = useFetchLobehubSkillConnections(
      isLobehubSkillEnabled && viewMode !== 'mcp',
    );
    const composioSWR = useFetchUserComposioConnections(isComposioEnabled && viewMode !== 'mcp');
    const agentSkillsSWR = useFetchAgentSkills(viewMode === 'skill');
    const skillsError =
      viewMode === 'skill'
        ? agentSkillsSWR.error
        : (lobehubSkillsSWR.error ?? composioSWR.error ?? connectorsSWR.error);
    const reloadSkills = () => {
      if (!isConnectorView) {
        void agentSkillsSWR.mutate();
        return;
      }
      if (viewMode !== 'mcp') {
        void lobehubSkillsSWR.mutate();
        void composioSWR.mutate();
      }
      void connectorsSWR.mutate();
    };

    // Load custom connectors (new connector store) so user-added OAuth MCP
    // connectors appear in the Connectors tab list.
    useEffect(() => {
      if (!isConnectorsInit) fetchConnectors();
    }, [isConnectorsInit, fetchConnectors]);

    // Load agent-owned connectors (across all agents) for the Agent Connectors
    // section — connector view only.
    useEffect(() => {
      if (isConnectorView && !isAgentBoundInit) fetchAgentBoundConnectors();
    }, [isConnectorView, isAgentBoundInit, fetchAgentBoundConnectors]);

    const getLobehubSkillServerByProvider = (providerId: string) => {
      return allLobehubSkillServers.find((server) => server.identifier === providerId);
    };

    const getComposioServerByIdentifier = (identifier: string) => {
      return allComposioServers.find((server) => server.identifier === identifier);
    };

    const connectionState = {
      isComposioActive: (identifier: string) =>
        getComposioServerByIdentifier(identifier)?.status === ComposioServerStatus.ACTIVE,
      isLobehubConnected: (providerId: string) =>
        getLobehubSkillServerByProvider(providerId)?.status === LobehubSkillStatus.CONNECTED,
    };

    // The connector catalog contains OAuth integrations, connected first.
    // A few dozen entries: cheap enough to derive on each render.
    const allIntegrations =
      viewMode === 'mcp'
        ? []
        : buildIntegrationItems({
            ...connectionState,
            pageOnlyProviderIds: CONNECTOR_PAGE_IDS,
            connectorAvailability: { composio: isComposioEnabled, lobehub: isLobehubSkillEnabled },
          });

    // Each workspace tab lists its own pool. Built-in tools, plugins and agent
    // connectors carry no visibility and stay with the shared pool; a connector
    // row lists under the tab of its visibility, and an OAuth integration
    // (Composio, LobeHub) under the tabs of its connector rows.
    const isPrivateTab = isConnectorView && visibility === 'private';
    const inTab = (c: ConnectorWithTools) => isInConnectorTab(c, visibility);
    const customConnectors = allCustomConnectors.filter(inTab);
    const marketplaceConnectors = allMarketplaceConnectors.filter(inTab);
    const tabVisibility = isConnectorView ? visibility : undefined;
    const integrations = allIntegrations.filter((item) => {
      if (item.type === 'composio')
        return isIntegrationInConnectorTab(
          item.serverType.identifier,
          connectorTabRows,
          tabVisibility,
          getComposioServerByIdentifier(item.serverType.identifier)?.connectedAccountId,
        );
      return isIntegrationInConnectorTab(item.provider.id, connectorTabRows, tabVisibility);
    });
    const communityMCPs = isPrivateTab
      ? []
      : installedPluginList.filter((plugin) => plugin.type === 'plugin');
    const customMCPs = isPrivateTab
      ? []
      : installedPluginList.filter((plugin) => plugin.type === 'customPlugin');
    const agentBoundConnectors = isPrivateTab
      ? []
      : viewMode === 'mcp'
        ? allAgentBoundConnectors.filter(hasCallableMcpEndpoint)
        : allAgentBoundConnectors;

    const connectorTabCount = countConnectorTabItems({
      customConnectors,
      integrations,
      marketplaceConnectors,
    });
    const hasAnySkills =
      viewMode === 'skill'
        ? marketAgentSkills.length > 0 || userAgentSkills.length > 0
        : connectorTabCount > 0 ||
          communityMCPs.length > 0 ||
          customMCPs.length > 0 ||
          agentBoundConnectors.length > 0;

    // The page header's refresh re-fetches every list this view shows, keeping
    // the painted rows until the new data lands.
    const refreshAll = () => {
      if (refreshing) return;
      setRefreshing(true);
      const requests = isConnectorView
        ? [
            ...(viewMode === 'mcp' ? [] : [lobehubSkillsSWR.mutate(), composioSWR.mutate()]),
            connectorsSWR.mutate(),
            fetchAgentBoundConnectors(),
          ]
        : [agentSkillsSWR.mutate()];
      void Promise.allSettled(requests).finally(() => setRefreshing(false));
    };
    const header = isPage ? renderHeader?.({ onRefresh: refreshAll, refreshing }) : undefined;

    const privateState = isPrivateTab
      ? privateTabState({
          count: connectorTabCount,
          error: connectorsSWR.error,
          isConnectorsInit,
        })
      : undefined;
    if (
      privateState === 'loading' ||
      (viewMode === 'skill' && !hasAnySkills && agentSkillsSWR.isLoading && !skillsError)
    )
      return (
        <>
          {header}
          <SkeletonList aria-busy paddingBlock={12} rows={4} />
        </>
      );
    if (privateState === 'error') {
      return (
        <>
          {header}
          <Center className={stylex.props(styles.container).className} paddingBlock={48}>
            <AsyncError
              error={connectorsSWR.error}
              variant={'block'}
              onRetry={() => void connectorsSWR.mutate()}
            />
          </Center>
        </>
      );
    }
    if (privateState === 'empty') {
      return (
        <>
          {header}
          <Center className={stylex.props(styles.container).className} paddingBlock={48}>
            <Empty
              description={t('skillView.privateConnectorsEmpty.desc')}
              icon={LockIcon}
              title={t('skillView.privateConnectorsEmpty.title')}
            />
          </Center>
        </>
      );
    }

    // A failed fetch must read as a failure with Retry, never as the "no skills"
    // empty (error gated ahead of empty).
    if (skillsError && !hasAnySkills) {
      return (
        <>
          {header}
          <Center className={stylex.props(styles.container).className} paddingBlock={48}>
            <AsyncError error={skillsError} variant={'block'} onRetry={reloadSkills} />
          </Center>
        </>
      );
    }

    if (!hasAnySkills) {
      return (
        <>
          {header}
          <Center className={stylex.props(styles.container).className} paddingBlock={48}>
            <Empty
              icon={SkillsIcon}
              description={
                viewMode === 'mcp'
                  ? t('apps.mcpDescription', { ns: 'discover' })
                  : t(viewMode === 'skill' ? 'skillView.empty.description' : 'tab.skillDesc')
              }
              title={
                viewMode === 'mcp'
                  ? t('apps.noInstalledMcp', { ns: 'discover' })
                  : t(viewMode === 'skill' ? 'skillView.empty.title' : 'tab.skillEmpty')
              }
            />
          </Center>
        </>
      );
    }

    const renderAgentSkills = (skills: typeof marketAgentSkills) =>
      skills.map((skill) => (
        <AgentSkillItem
          isSelected={selectedIdentifier === skill.id}
          key={skill.id}
          skill={skill}
          onSelect={onSelect ? () => onSelect(skill.id, 'agent-skill') : undefined}
        />
      ));

    // ── Connector entries, filtered by the page search ───────────────────────
    const match = (...fields: Array<string | null | undefined>) =>
      matchesConnectorKeyword(keyword, fields);

    const communitySkillItems = integrations.filter((item) =>
      matchesIntegrationKeyword(item, keyword, t),
    );
    const visibleCommunityMCPs = communityMCPs.filter((p) =>
      match(p.title, p.identifier, p.author),
    );
    const visibleMarketplaceConnectors = marketplaceConnectors.filter((c) =>
      match(c.name, c.identifier),
    );
    const visibleCustomMCPs = customMCPs.filter((p) => match(p.title, p.identifier));
    const visibleCustomConnectors = customConnectors.filter((c) => match(c.name, c.identifier));
    const visibleAgentConnectors = agentBoundConnectors.filter((c) =>
      match(c.name, c.identifier, c.agentTitle),
    );

    const renderIntegration = (item: IntegrationItem) => {
      switch (item.type) {
        case 'lobehub': {
          return (
            <LobehubSkillItem
              connectable={isLobehubSkillEnabled}
              isSelected={selectedIdentifier === item.provider.id}
              key={item.provider.id}
              openWhenDisconnected={hasConnectorPage(item.provider.id)}
              provider={item.provider}
              server={getLobehubSkillServerByProvider(item.provider.id)}
              onDelete={onDeleteSelected}
              onSelect={
                onSelect ? () => onSelect(item.provider.id, 'lobehub-connector') : undefined
              }
            />
          );
        }
        case 'composio': {
          return (
            <ComposioSkillItem
              isSelected={selectedIdentifier === item.serverType.identifier}
              key={item.serverType.identifier}
              server={getComposioServerByIdentifier(item.serverType.identifier)}
              serverType={item.serverType}
              onDelete={onDeleteSelected}
              onSelect={onSelect ? () => onSelect(item.serverType.identifier, 'plugin') : undefined}
            />
          );
        }
        default: {
          return null;
        }
      }
    };

    const renderCommunityMCPs = () => [
      ...visibleCommunityMCPs.map((plugin) => (
        <McpSkillItem
          author={plugin.author}
          avatar={plugin.avatar}
          identifier={plugin.identifier}
          isSelected={selectedIdentifier === plugin.identifier}
          key={plugin.identifier}
          runtimeType={plugin.runtimeType}
          title={plugin.title || plugin.identifier}
          type={plugin.type as LobeToolType}
          onSelect={onSelect ? () => onSelect(plugin.identifier, 'plugin') : undefined}
        />
      )),
      // Marketplace installs made on the connector path (no legacy plugin row)
      ...visibleMarketplaceConnectors.map((c) => (
        <McpSkillItem
          avatar={c.metadata?.avatar as string | undefined}
          identifier={c.identifier}
          isSelected={selectedIdentifier === c.identifier}
          key={c.id}
          runtimeType="mcp"
          title={c.name || c.identifier}
          type={'plugin' as LobeToolType}
          onSelect={onSelect ? () => onSelect(c.identifier, 'mcp-connector') : undefined}
        />
      )),
    ];

    // Custom connectors from the connector store (user-added OAuth MCP servers),
    // then legacy custom MCP plugins.
    const renderCustomConnectors = () => [
      ...visibleCustomConnectors.map((c) => {
        const brokenAccounts = countAccountsNeedingReauth(c.links);
        return (
          <McpSkillItem
            identifier={c.identifier}
            isSelected={selectedIdentifier === c.identifier}
            key={c.id}
            runtimeType="mcp"
            title={c.name || c.identifier}
            type={'customPlugin' as LobeToolType}
            description={
              brokenAccounts > 0 ? <AccountsNeedReauth count={brokenAccounts} /> : undefined
            }
            onSelect={onSelect ? () => onSelect(c.identifier, 'mcp-connector') : undefined}
          />
        );
      }),
      ...visibleCustomMCPs.map((plugin) => (
        <McpSkillItem
          author={plugin.author}
          avatar={plugin.avatar}
          identifier={plugin.identifier}
          isSelected={selectedIdentifier === plugin.identifier}
          key={plugin.identifier}
          runtimeType={plugin.runtimeType}
          title={plugin.title || plugin.identifier}
          type={plugin.type as LobeToolType}
          onSelect={onSelect ? () => onSelect(plugin.identifier, 'mcp-connector') : undefined}
        />
      )),
    ];

    const renderAgentConnectors = () =>
      visibleAgentConnectors.map((c) => (
        <AgentConnectorItem
          connector={c}
          isSelected={selectedIdentifier === c.id}
          key={c.id}
          onSelect={onSelect ? () => onSelect(c.id, 'agent-connector') : undefined}
        />
      ));

    const toggle = (setter: typeof setCollapsed) => (key: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    const toggleSection = toggle(setCollapsed);
    const toggleExpanded = toggle(setExpanded);

    // Page catalogs share the layout, but keep their own sources and search fields.
    if (isPage) {
      // Installed groups what is already added (enabled built-ins, connected
      // OAuth apps), so the type groups below read as what is left to add.
      const isConnected = (item: IntegrationItem) => isIntegrationConnected(item, connectionState);
      const oauth = partitionByInstalled(communitySkillItems, isConnected);

      const sections = (
        isConnectorView
          ? [
              {
                items: oauth.installed.map(renderIntegration),
                key: 'installed',
                label: t('connectorMarket.section.installed'),
              },
              {
                // With the market on, the ones left to connect lead the
                // Connectors Discover page instead.
                items: showMarket ? [] : oauth.available.map(renderIntegration),
                key: 'communityConnectors',
                label: t('skillGroup.communityConnectors', 'OAuth Connectors'),
              },
              {
                items: renderCommunityMCPs(),
                key: 'communityTools',
                label: t('skillGroup.communityTools', 'Marketplace Tools'),
              },
              {
                items: renderCustomConnectors(),
                key: 'customConnectors',
                label: t('skillGroup.customConnectors', 'Custom Connectors'),
              },
              {
                items: renderAgentConnectors(),
                key: 'agentConnectors',
                label: t('skillGroup.agentConnectors', 'Agent Connectors'),
              },
            ]
          : [
              {
                items: renderAgentSkills(
                  marketAgentSkills.filter((skill) =>
                    match(skill.name, skill.identifier, skill.description),
                  ),
                ),
                key: 'communitySkills',
                label: t('skillGroup.communitySkills'),
              },
              {
                items: renderAgentSkills(
                  userAgentSkills.filter((skill) =>
                    match(skill.name, skill.identifier, skill.description),
                  ),
                ),
                key: 'customSkills',
                label: t('skillGroup.customSkills'),
              },
            ]
      ).filter((section) => section.items.length > 0);

      return (
        <>
          {header}
          {sections.length === 0 ? (
            // Searching found nothing: say what was searched and offer the way back.
            <Center paddingBlock={64}>
              <Empty
                description={t('connectorMarket.empty.searchDesc')}
                icon={SearchX}
                action={
                  onClearKeyword && (
                    <Button onClick={onClearKeyword}>{t('connectorMarket.empty.clear')}</Button>
                  )
                }
                title={t(
                  isConnectorView ? 'connectorMarket.empty.search' : 'skillView.empty.search',
                  { keyword: keyword?.trim() },
                )}
              />
            </Center>
          ) : (
            <div {...stylex.props(styles.pageSections)}>
              {sections.map(({ items, key, label }) => {
                const isExpanded = expanded.has(key);
                // A search shows every hit; otherwise long groups preview their first rows.
                const searching = !!keyword?.trim();
                const { hiddenCount, visible } = getVisibleSectionItems(
                  items,
                  isExpanded || searching,
                );
                const expandable = isSectionExpandable({
                  expanded: isExpanded,
                  hiddenCount,
                  searching,
                });
                const toggleLabel = isExpanded
                  ? t('connectorMarket.section.showLess')
                  : `${t('connectorMarket.section.showAll')} (${items.length})`;
                return (
                  <section key={key} {...stylex.props(styles.pageSection)}>
                    <PageSectionHeading
                      expandable={expandable}
                      expanded={isExpanded}
                      label={label}
                      toggleLabel={toggleLabel}
                      onToggle={() => toggleExpanded(key)}
                    />
                    <div {...stylex.props(styles.pageGrid)}>{visible}</div>
                  </section>
                );
              })}
            </div>
          )}
        </>
      );
    }

    // ── Sidebar list (skills page, mobile) ───────────────────────────────────
    const renderSection = (key: string, label: string, children: React.ReactNode) => {
      const isCollapsed = collapsed.has(key);
      return (
        <>
          <div
            {...stylex.props(styles.sectionHeader)}
            aria-expanded={!isCollapsed}
            role={'button'}
            tabIndex={0}
            onClick={() => toggleSection(key)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              toggleSection(key);
            }}
          >
            {isCollapsed ? <ChevronRightIcon size={10} /> : <ChevronDownIcon size={10} />}
            {label}
          </div>
          {!isCollapsed && children}
        </>
      );
    };

    // Connectors view: tools / MCP items (API-level permissions).
    // Skills view: prompt / agent-based skills.
    // Skills view only shows agent-based community skills; LobeHub / Composio
    // OAuth connectors live exclusively in the Connectors view.
    const hasCommunitySkills = !isConnectorView && marketAgentSkills.length > 0;
    const communityToolCount = visibleCommunityMCPs.length + visibleMarketplaceConnectors.length;
    const hasCommunityTools = communityToolCount > 0 && isConnectorView;
    const customConnectorCount = visibleCustomConnectors.length + visibleCustomMCPs.length;
    const hasCustomConnectors = isConnectorView && customConnectorCount > 0;
    const hasCustomSkills = userAgentSkills.length > 0 && !isConnectorView;
    const hasCommunityConnectors = communitySkillItems.length > 0 && isConnectorView;
    const hasAgentConnectors = isConnectorView && visibleAgentConnectors.length > 0;

    return (
      <div {...stylex.props(styles.container)}>
        {header}
        {hasCommunityConnectors &&
          renderSection(
            'communityConnectors',
            t('skillGroup.communityConnectors', 'OAuth Connectors'),
            communitySkillItems.map(renderIntegration),
          )}

        {hasCommunitySkills &&
          renderSection(
            'communitySkills',
            t('skillGroup.communitySkills', 'Marketplace Skills'),
            renderAgentSkills(marketAgentSkills),
          )}

        {hasCommunityTools &&
          renderSection(
            'communityTools',
            t('skillGroup.communityTools', 'Marketplace Tools'),
            renderCommunityMCPs(),
          )}

        {hasCustomConnectors &&
          renderSection(
            'customConnectors',
            t('skillGroup.customConnectors', 'Custom Connectors'),
            renderCustomConnectors(),
          )}

        {hasAgentConnectors &&
          renderSection(
            'agentConnectors',
            t('skillGroup.agentConnectors', 'Agent Connectors'),
            renderAgentConnectors(),
          )}

        {hasCustomSkills &&
          renderSection(
            'customSkills',
            t('skillGroup.customSkills', 'Custom Skills'),
            renderAgentSkills(userAgentSkills),
          )}
      </div>
    );
  },
);

SkillList.displayName = 'SkillList';

export default SkillList;
