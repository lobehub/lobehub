'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { Button, DropdownMenu, Flexbox, Icon, SearchBar, Tabs, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, Grid2x2Plus, Import, LockIcon, Plus, Store, UsersIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { NavPanelDensityContext } from '@/features/NavPanel/density';
import { createMarketSkillStoreModal, createSkillStoreModal } from '@/features/SkillStore';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { useInterfaceDensity } from '@/styles/density';
import { densityTokens, sidebarRow } from '@/styles/density.stylex';
import { densityVars } from '@/styles/densityVars';

import ConnectorManagePolicy from './ConnectorManagePolicy';
import { type ToolDetailType } from './SkillDetail';
import SkillList, { type SkillViewMode } from './SkillList';
import { SkillListVariantProvider } from './SkillListRow';

const styles = stylex.create({
  // @lobehub/ui paints every open dropdown trigger with `colorFillTertiary`
  // (`.lobe-dropdown-menu-trigger[data-popup-open]`, `lobe-popup` layer), which
  // wins over the primary Button's own open state and leaves its light text on
  // a near-white fill. Restore the primary open state with the same tokens the
  // Button uses, so the label stays readable in both themes.
  addTrigger: {
    backgroundColor: {
      'default': null,
      ':is([data-popup-open])': cssVar.colorPrimaryActive,
    },
    color: {
      'default': null,
      ':is([data-popup-open])': cssVar.colorBgLayout,
    },
  },
  body: { overflowY: 'auto', flex: '1', paddingBlock: '4px', paddingInline: '8px' },
  columnTabs: { paddingInline: '8px' },
  pageBody: { paddingBlockStart: '0', paddingBlockEnd: '24px', paddingInline: '0' },
  // Title and one line of what connectors do on the left; search and the page
  // actions on the right, the primary Add last.
  pageHeader: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: densityTokens['--lobe-density-section-gap'],
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBlockStart: '32px',
    paddingBlockEnd: '8px',
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  pageSearch: { width: '240px' },
  pageTabs: { paddingInline: densityTokens['--lobe-density-content-gap'] },
  pageTitle: {
    marginBlock: 0,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1.3,
    color: cssVar.colorText,
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
  /** Fill the page instead of sitting as a 300px column beside the detail (mobile). */
  fullWidth?: boolean;
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
    fullWidth,
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

    const isConnectorView = viewMode === 'connector';
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
    const connectorsDesc = isPrivateTab
      ? t('skillView.privateConnectorsDesc')
      : visibility
        ? t('skillView.workspaceConnectorsDesc')
        : t('skillView.connectorsDesc');
    const addConnectorTitle = t('connector.add.title', {
      defaultValue: 'Add Custom Connector',
      ns: 'tool',
    });
    if (page) {
      const addItems = [
        ...(isConnectorView
          ? [
              {
                desc:
                  canAddConnector || isPolicyPending
                    ? t('connectorMarket.add.customDesc')
                    : t('tools.connectorFeedback.manageOnly'),
                disabled: !canAddConnector,
                icon: <Icon icon={Grid2x2Plus} />,
                key: 'custom',
                label: t('connectorMarket.add.custom'),
                onClick: () => setShowAddConnector(true),
              },
            ]
          : []),
        // A store install joins the shared pool, so the private tab omits it
        ...(isPrivateTab
          ? []
          : [
              {
                desc: t(
                  isConnectorView
                    ? 'connectorMarket.add.browseStoreDesc'
                    : 'skillView.browseStoreDesc',
                ),
                icon: <Icon icon={Store} />,
                key: 'store',
                label: t('connectorMarket.add.browseStore'),
                onClick: handleOpenStore,
              },
            ]),
        ...(!isConnectorView
          ? [
              {
                desc: t('agentSkillModal.sources'),
                disabled: !canCreate,
                icon: <Icon icon={Import} />,
                key: 'import',
                label: t('agentSkillModal.title'),
                onClick: openSkillImportModal,
              },
            ]
          : []),
      ];
      const searchPlaceholder = t(
        isConnectorView ? 'connectorMarket.search.placeholder' : 'skillView.search.placeholder',
      );

      const renderHeader = () => (
        <>
          <div {...stylex.props(styles.pageHeader)}>
            <Flexbox gap={4} style={{ minWidth: 0 }}>
              <h1 {...stylex.props(styles.pageTitle)}>
                {t(isConnectorView ? 'skillView.connectors' : 'skillView.skills')}
              </h1>
              <Text type={'secondary'}>
                {isConnectorView ? connectorsDesc : t('skillView.skillsDesc')}
              </Text>
            </Flexbox>
            <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
              <SearchBar
                allowClear
                aria-label={searchPlaceholder}
                className={stylex.props(styles.pageSearch).className}
                placeholder={searchPlaceholder}
                value={keyword}
                variant={'outlined'}
                onInputChange={setKeyword}
              />
              <DropdownMenu items={addItems} placement={'bottomRight'}>
                <Button
                  className={stylex.props(styles.addTrigger).className}
                  icon={Plus}
                  type={'primary'}
                >
                  {t('connectorMarket.add')}
                  <Icon icon={ChevronDown} size={14} />
                </Button>
              </DropdownMenu>
            </Flexbox>
          </div>
          {visibilityTabs && <div {...stylex.props(styles.pageTabs)}>{visibilityTabs}</div>}
          {/* The member policy governs the shared pool only */}
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
          <CustomConnectorModal
            open={showAddConnector}
            visibility={visibility}
            onClose={() => setShowAddConnector(false)}
          />
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
