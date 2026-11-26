'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { Button, Icon, Tabs, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Grid2x2Plus, Import, LockIcon, Store, UsersIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { pillTabClassNames } from '@/features/Marketplace/pillTabs';
import { NavPanelDensityContext } from '@/features/NavPanel/density';
import { createMarketSkillStoreModal, createSkillStoreModal } from '@/features/SkillStore';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { useInterfaceDensity } from '@/styles/density';
import { densityTokens, sidebarRow } from '@/styles/density.stylex';
import { densityVars } from '@/styles/densityVars';

import CatalogPageHeader from './CatalogPageHeader';
import ConnectorManagePolicy from './ConnectorManagePolicy';
import { type ToolDetailType } from './SkillDetail';
import SkillList, { type SkillListHeaderContext, type SkillViewMode } from './SkillList';
import { SkillListVariantProvider } from './SkillListRow';

const styles = stylex.create({
  body: { overflowY: 'auto', flex: '1', paddingBlock: '4px', paddingInline: '8px' },
  columnTabs: { paddingInline: '8px' },
  pageBody: { paddingBlockStart: '0', paddingBlockEnd: '24px', paddingInline: '0' },
  // 8px under the header + 12px: the Codex 20px from description to view tabs.
  pageTabs: {
    paddingBlockStart: densityTokens['--lobe-density-content-gap'],
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  header: {
    display: 'flex',
    flexShrink: 0,
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: sidebarRow.headerHeight,
    paddingInline: densityTokens['--lobe-density-card-padding'],
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  root: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
    minWidth: '260px',
    borderInlineEndWidth: '1px',
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: cssVar.colorBorderSecondary,
  },
  tooltipAnchor: { display: 'inline-flex' },
});

interface LeftPanelProps {
  /**
   * Page only: lay the header out for a phone. The search field moves under
   * the title row, which keeps just refresh and Add, so nothing overflows.
   */
  compact?: boolean;
  /** Fill the page instead of sitting as a 300px column beside the detail (mobile). */
  fullWidth?: boolean;
  /** Rendered under the page header, e.g. the Marketplace Discover / Installed tabs. */
  headerExtra?: ReactNode;
  onDeleteSelected: () => void;
  onSelect: (identifier: string, type: ToolDetailType) => void;
  onVisibilityChange?: (visibility: ConnectorVisibility) => void;
  /** Render as the page-level list a row opens a second-level detail from. */
  page?: boolean;
  selectedIdentifier?: string;
  viewMode: SkillViewMode;
  /**
   * Workspace connectors only: the active tab — the shared pool (`public`) or
   * the caller's private connectors. Unset outside a workspace (no tabs).
   */
  visibility?: ConnectorVisibility;
}

const LeftPanel = memo<LeftPanelProps>(
  ({
    compact,
    fullWidth,
    headerExtra,
    onDeleteSelected,
    onSelect,
    onVisibilityChange,
    page,
    selectedIdentifier,
    viewMode,
    visibility,
  }) => {
    const { t } = useTranslation(['setting', 'tool']);
    const interfaceDensity = useInterfaceDensity();
    const [showAddConnector, setShowAddConnector] = useState(false);
    const [keyword, setKeyword] = useState('');

    const isConnectorView = viewMode !== 'skill';
    // Mobile column only: it has no Discover / Installed tabs, so the store
    // button stays its way to find more.
    const handleOpenStore = isConnectorView ? createSkillStoreModal : createMarketSkillStoreModal;
    const { allowed: canCreate } = usePermission('create_content');
    const isPrivateTab = isConnectorView && visibility === 'private';
    // Adding a shared workspace connector follows the same member policy as
    // editing one; a private connector is the caller's own and skips it.
    const { canManage: canManageShared, isPending: isSharedPolicyPending } =
      useConnectorManageable();
    const canAddConnector = isPrivateTab || canManageShared;
    const isPolicyPending = !isPrivateTab && isSharedPolicyPending;
    const visibilityTabs = isConnectorView && visibility && (
      <Tabs
        activeKey={visibility}
        // Page: the Codex Public / Personal pills; column: the compact default.
        classNames={page ? pillTabClassNames : undefined}
        size={page ? 'middle' : undefined}
        variant={page ? 'rounded' : undefined}
        items={[
          {
            icon: <Icon icon={UsersIcon} />,
            key: 'public',
            label: t('skillView.connectorTabs.workspace'),
          },
          {
            icon: <Icon icon={LockIcon} />,
            key: 'private',
            label: t('skillView.connectorTabs.private'),
          },
        ]}
        onChange={(key) => onVisibilityChange?.(key as ConnectorVisibility)}
      />
    );
    const addConnectorTitle = t('connector.add.title', {
      defaultValue: 'Add Custom Connector',
      ns: 'tool',
    });
    if (page) {
      const renderHeader = ({ onRefresh, refreshing }: SkillListHeaderContext) => (
        <>
          <CatalogPageHeader
            compact={compact}
            keyword={keyword}
            refreshing={refreshing}
            viewMode={viewMode}
            visibility={visibility}
            toolbarExtra={
              isConnectorView && !isPrivateTab && <ConnectorManagePolicy variant={'toolbar'} />
            }
            onKeywordChange={setKeyword}
            onRefresh={onRefresh}
          />
          {visibilityTabs && <div {...stylex.props(styles.pageTabs)}>{visibilityTabs}</div>}
          {headerExtra}
          {/* A member who may not manage shared connectors reads why once, here */}
          {isConnectorView && !isPrivateTab && <ConnectorManagePolicy variant={'page'} />}
        </>
      );

      return (
        <SkillListVariantProvider value={'page'}>
          <div {...stylex.props(styles.pageBody)}>
            <SkillList
              keyword={keyword}
              renderHeader={renderHeader}
              viewMode={viewMode}
              visibility={visibility}
              onClearKeyword={() => setKeyword('')}
              onDeleteSelected={onDeleteSelected}
              onSelect={onSelect}
            />
          </div>
        </SkillListVariantProvider>
      );
    }

    return (
      <NavPanelDensityContext value={fullWidth ? null : interfaceDensity}>
        <div
          className={stylex.props(styles.root).className}
          style={fullWidth ? { borderInlineEnd: 'none', width: '100%' } : undefined}
        >
          <div {...stylex.props(styles.header)}>
            <Text strong style={{ fontSize: densityVars.fontSize }}>
              {isConnectorView
                ? t('skillView.connectors', 'Connectors')
                : t('skillView.skills', 'Skills')}
            </Text>

            {/* lobe-design-ignore LOBE-DIV-CLICK: not a control; keeps header button clicks from reaching the panel */}
            <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              {isConnectorView ? (
                // Connector view: single action to add a custom OAuth connector.
                <Tooltip
                  title={
                    canAddConnector || isPolicyPending
                      ? addConnectorTitle
                      : t('tools.connectorFeedback.manageOnly')
                  }
                >
                  {/* Disabled buttons swallow hover events; the wrapper anchors the tooltip. */}
                  <span {...stylex.props(styles.tooltipAnchor)}>
                    <Button
                      aria-label={addConnectorTitle}
                      disabled={!canAddConnector}
                      icon={Grid2x2Plus}
                      size="small"
                      onClick={() => setShowAddConnector(true)}
                    />
                  </span>
                </Tooltip>
              ) : (
                <Button
                  aria-label={t('agentSkillModal.title')}
                  disabled={!canCreate}
                  icon={Import}
                  size="small"
                  title={t('agentSkillModal.title')}
                  onClick={openSkillImportModal}
                />
              )}
              {!isPrivateTab && (
                <Button
                  aria-label={t('skillStore.title')}
                  icon={<Icon icon={Store} />}
                  size="small"
                  onClick={handleOpenStore}
                />
              )}
            </div>
          </div>

          {visibilityTabs && <div {...stylex.props(styles.columnTabs)}>{visibilityTabs}</div>}
          {isConnectorView && !isPrivateTab && <ConnectorManagePolicy />}

          <div {...stylex.props(styles.body)}>
            <SkillList
              selectedIdentifier={selectedIdentifier}
              viewMode={viewMode}
              visibility={visibility}
              onDeleteSelected={onDeleteSelected}
              onSelect={onSelect}
            />
          </div>
        </div>
        <CustomConnectorModal
          open={showAddConnector}
          visibility={visibility}
          onClose={() => setShowAddConnector(false)}
        />
      </NavPanelDensityContext>
    );
  },
);

LeftPanel.displayName = 'SkillSettingsLeftPanel';

export default LeftPanel;
