'use client';

import { Button, Center, Empty } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon, ChevronRightIcon, SearchX } from 'lucide-react';
import type React from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  composioStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { connectorSelectors } from '@/store/tool/slices/connector';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';
import { type LobeToolType } from '@/types/tool/tool';

import AgentConnectorItem from './AgentConnectorItem';
import AgentSkillItem from './AgentSkillItem';
import BuiltinSkillItem from './BuiltinSkillItem';
import ComposioSkillItem from './ComposioSkillItem';
import { AccountsNeedReauth, countAccountsNeedingReauth } from './ConnectorRowFeedback';
import {
  buildIntegrationItems,
  getVisibleSectionItems,
  type IntegrationItem,
  isIntegrationConnected,
  matchesConnectorKeyword,
  matchesIntegrationKeyword,
  partitionByInstalled,
} from './connectorSections';
import LobehubSkillItem from './LobehubSkillItem';
import McpSkillItem from './McpSkillItem';
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
    paddingBlockStart: '12px',
    paddingBlockEnd: '4px',
    paddingInline: '4px',
    fontSize: '12px',
    fontWeight: 500,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  // Page groups: a heading with its count, then a two-column catalog of
  // borderless rows; groups are separated by whitespace, not rules.
  pageSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
  pageSections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '40px',
    paddingBlockStart: '24px',
  },
  pageGrid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(2, minmax(0, 1fr))', [media.lg]: 'minmax(0, 1fr)' },
    columnGap: '32px',
    rowGap: '4px',
  },
  sectionHeaderPage: {
    cursor: 'default',
    gap: '8px',
    paddingBlock: '0',
    paddingInline: '12px',
    fontSize: cssVar.fontSizeHeading5,
    fontWeight: 600,
    color: { 'default': cssVar.colorText, ':hover': cssVar.colorText },
  },
  sectionCount: { fontWeight: 400, color: cssVar.colorTextDescription },
  showAll: { alignSelf: 'flex-start', marginInlineStart: '4px' },
});

export type SkillViewMode = 'connector' | 'skill';

interface SkillListProps {
  /** Page search: filters every group by name, identifier and description. */
  keyword?: string;
  onClearKeyword?: () => void;
  onDeleteSelected?: () => void;
  onSelect?: (identifier: string, type: ToolDetailType) => void;
  /** Page header above the groups. */
  renderHeader?: () => React.ReactNode;
  selectedIdentifier?: string;
  viewMode?: SkillViewMode;
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
  }) => {
    const { t } = useTranslation('setting');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const isPage = useSkillListVariant() === 'page';

    const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
    const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
    const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
    const allComposioServers = useToolStore(composioStoreSelectors.getServers, isEqual);
    const installedPluginList = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
    const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
    const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
    const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
    const customConnectors = useToolStore(connectorSelectors.customConnectors, isEqual);
    const marketplaceConnectors = useToolStore(
      connectorSelectors.marketplaceMcpConnectors,
      isEqual,
    );
    const isConnectorsInit = useToolStore((s) => s.isConnectorsInit);
    const fetchConnectors = useToolStore((s) => s.fetchConnectors);
    const agentBoundConnectors = useToolStore(connectorSelectors.agentBoundConnectors, isEqual);
    const isAgentBoundInit = useToolStore((s) => s.isAgentBoundInit);
    const fetchAgentBoundConnectors = useToolStore((s) => s.fetchAgentBoundConnectors);
    const allBuiltinTools = useToolStore((s) => s.builtinTools, isEqual);
    const uninstalledBuiltinTools = useToolStore(
      builtinToolSelectors.uninstalledBuiltinTools,
      isEqual,
    );

    const [
      useFetchLobehubSkillConnections,
      useFetchUserComposioConnections,
      useFetchAgentSkills,
      useFetchUninstalledBuiltinTools,
    ] = useToolStore((s) => [
      s.useFetchLobehubSkillConnections,
      s.useFetchUserComposioConnections,
      s.useFetchAgentSkills,
      s.useFetchUninstalledBuiltinTools,
    ]);

    useFetchInstalledPlugins();
    // Keep each SWR handle so a failed skill fetch surfaces error + Retry instead
    // of a fake-empty list (each hook syncs into the store only on success —
    //
    const lobehubSkillsSWR = useFetchLobehubSkillConnections(isLobehubSkillEnabled);
    const composioSWR = useFetchUserComposioConnections(isComposioEnabled);
    const agentSkillsSWR = useFetchAgentSkills(true);
    const builtinToolsSWR = useFetchUninstalledBuiltinTools(true);
    const skillsError =
      viewMode === 'skill'
        ? (agentSkillsSWR.error ?? builtinToolsSWR.error)
        : (lobehubSkillsSWR.error ?? composioSWR.error ?? builtinToolsSWR.error);
    const reloadSkills = () => {
      void lobehubSkillsSWR.mutate();
      void composioSWR.mutate();
      void agentSkillsSWR.mutate();
      // The uninstalled-builtin list is a replica now: revalidate re-runs its
      // network sync without blanking the painted list.
      void builtinToolsSWR.revalidate();
    };

    // Load custom connectors (new connector store) so user-added OAuth MCP
    // connectors appear in the Connectors tab list.
    useEffect(() => {
      if (!isConnectorsInit) fetchConnectors();
    }, [isConnectorsInit, fetchConnectors]);

    // Load agent-owned connectors (across all agents) for the Agent Connectors
    // section — connector view only.
    const isConnectorView = viewMode === 'connector';
    useEffect(() => {
      if (isConnectorView && !isAgentBoundInit) fetchAgentBoundConnectors();
    }, [isConnectorView, isAgentBoundInit, fetchAgentBoundConnectors]);

    const getLobehubSkillServerByProvider = (providerId: string) => {
      return allLobehubSkillServers.find((server) => server.identifier === providerId);
    };

    const getComposioServerByIdentifier = (identifier: string) => {
      return allComposioServers.find((server) => server.identifier === identifier);
    };

    const isBuiltinToolInstalled = (identifier: string) => {
      return !uninstalledBuiltinTools.includes(identifier);
    };

    const connectionState = {
      isBuiltinToolInstalled,
      isComposioActive: (identifier: string) =>
        getComposioServerByIdentifier(identifier)?.status === ComposioServerStatus.ACTIVE,
      isLobehubConnected: (providerId: string) =>
        getLobehubSkillServerByProvider(providerId)?.status === LobehubSkillStatus.CONNECTED,
    };

    // Integrations (built-in skills / tools and the OAuth catalog, connected
    // first), then installed plugins split into community and custom MCPs.
    // A few dozen entries: cheap enough to derive on each render.
    const integrations = buildIntegrationItems({
      ...connectionState,
      allBuiltinTools,
      builtinSkills,
      connectorAvailability: { composio: isComposioEnabled, lobehub: isLobehubSkillEnabled },
    });
    const communityMCPs = installedPluginList.filter((plugin) => plugin.type === 'plugin');
    const customMCPs = installedPluginList.filter((plugin) => plugin.type === 'customPlugin');

    const hasAnySkills =
      viewMode === 'skill'
        ? builtinSkills.length > 0 || marketAgentSkills.length > 0 || userAgentSkills.length > 0
        : builtinSkills.length > 0 ||
          integrations.length > 0 ||
          marketAgentSkills.length > 0 ||
          userAgentSkills.length > 0 ||
          communityMCPs.length > 0 ||
          marketplaceConnectors.length > 0 ||
          customMCPs.length > 0 ||
          agentBoundConnectors.length > 0;

    const header = isPage ? renderHeader?.() : undefined;

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
              title={t(viewMode === 'skill' ? 'skillView.empty.title' : 'tab.skillEmpty')}
              description={t(
                viewMode === 'skill' ? 'skillView.empty.description' : 'tab.skillDesc',
              )}
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

    const builtinTitle = (tool: { identifier: string; title?: string }) =>
      t(`tools.builtins.${tool.identifier}.title`, {
        defaultValue: tool.title || tool.identifier,
      });

    const integrationMatches = (item: IntegrationItem) =>
      matchesIntegrationKeyword(item, keyword, t);

    const builtinToolItems = integrations.filter(
      (i) => i.type === 'builtin' && integrationMatches(i),
    );
    const builtinSkillItems = integrations.filter((i) => i.type === 'builtinAgent');
    const communitySkillItems = integrations.filter(
      (i) => (i.type === 'lobehub' || i.type === 'composio') && integrationMatches(i),
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
        case 'builtin': {
          return (
            <BuiltinSkillItem
              avatar={item.builtinTool.avatar}
              description={item.builtinTool.description}
              identifier={item.builtinTool.identifier}
              isSelected={selectedIdentifier === item.builtinTool.identifier}
              key={item.builtinTool.identifier}
              title={builtinTitle(item.builtinTool)}
              onSelect={
                onSelect ? () => onSelect(item.builtinTool.identifier, 'builtin') : undefined
              }
            />
          );
        }
        case 'lobehub': {
          return (
            <LobehubSkillItem
              isSelected={selectedIdentifier === item.provider.id}
              key={item.provider.id}
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
      const builtins = partitionByInstalled(builtinToolItems, isConnected);
      const oauth = partitionByInstalled(communitySkillItems, isConnected);

      const sections = (
        isConnectorView
          ? [
              {
                items: [...builtins.installed, ...oauth.installed].map(renderIntegration),
                key: 'installed',
                label: t('connectorMarket.section.installed'),
              },
              {
                items: builtins.available.map(renderIntegration),
                key: 'builtinTools',
                label: t('skillGroup.builtinTools', 'Built-in Tools'),
              },
              {
                items: oauth.available.map(renderIntegration),
                key: 'communityConnectors',
                label: t('skillGroup.communityConnectors', 'OAuth Connectors'),
              },
              {
                items: renderCommunityMCPs(),
                key: 'communityTools',
                label: t('skillGroup.communityTools', 'Community Tools'),
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
                items: builtinSkills
                  .filter((skill) =>
                    match(
                      t(`tools.builtins.${skill.identifier}.title`, { defaultValue: skill.name }),
                      skill.identifier,
                      t(`tools.builtins.${skill.identifier}.description`, {
                        defaultValue: skill.description,
                      }),
                    ),
                  )
                  .map((skill) => (
                    <AgentSkillItem
                      key={skill.identifier}
                      skill={skill}
                      onSelect={
                        onSelect ? () => onSelect(skill.identifier, 'builtin-skill') : undefined
                      }
                    />
                  )),
                key: 'builtinSkills',
                label: t('skillGroup.builtinSkills'),
              },
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
                const { hiddenCount, visible } = getVisibleSectionItems(
                  items,
                  isExpanded || !!keyword?.trim(),
                );
                return (
                  <section key={key} {...stylex.props(styles.pageSection)}>
                    <h3 {...stylex.props(styles.sectionHeader, styles.sectionHeaderPage)}>
                      {label}
                      <span {...stylex.props(styles.sectionCount)}>{items.length}</span>
                    </h3>
                    <div {...stylex.props(styles.pageGrid)}>{visible}</div>
                    {(hiddenCount > 0 || isExpanded) && (
                      <Button
                        className={stylex.props(styles.showAll).className}
                        size={'small'}
                        type={'text'}
                        onClick={() => toggleExpanded(key)}
                      >
                        {isExpanded
                          ? t('connectorMarket.section.showLess')
                          : `${t('connectorMarket.section.showAll')} (${items.length})`}
                      </Button>
                    )}
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
    const hasBuiltinTools = builtinToolItems.length > 0 && isConnectorView;
    const hasBuiltinSkills = builtinSkillItems.length > 0 && !isConnectorView;
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
        {hasBuiltinTools &&
          renderSection(
            'builtinTools',
            t('skillGroup.builtinTools', 'Built-in Tools'),
            builtinToolItems.map(renderIntegration),
          )}

        {hasBuiltinSkills &&
          renderSection(
            'builtinSkills',
            t('skillGroup.builtinSkills', 'Built-in Skills'),
            builtinSkillItems.map((item) => {
              if (item.type !== 'builtinAgent') return null;
              return (
                <AgentSkillItem
                  isSelected={selectedIdentifier === item.builtinAgentSkill.identifier}
                  key={item.builtinAgentSkill.identifier}
                  skill={item.builtinAgentSkill}
                  onSelect={
                    onSelect
                      ? () => onSelect(item.builtinAgentSkill.identifier, 'builtin-skill')
                      : undefined
                  }
                />
              );
            }),
          )}

        {hasCommunityConnectors &&
          renderSection(
            'communityConnectors',
            t('skillGroup.communityConnectors', 'OAuth Connectors'),
            communitySkillItems.map(renderIntegration),
          )}

        {hasCommunitySkills &&
          renderSection(
            'communitySkills',
            t('skillGroup.communitySkills', 'Community Skills'),
            renderAgentSkills(marketAgentSkills),
          )}

        {hasCommunityTools &&
          renderSection(
            'communityTools',
            t('skillGroup.communityTools', 'Community Tools'),
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
