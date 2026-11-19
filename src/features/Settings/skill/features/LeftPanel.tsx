'use client';

import { Button, DropdownMenu, Flexbox, Icon, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, Grid2x2Plus, Import, Plus, Store } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { NavPanelDensityContext } from '@/features/NavPanel/density';
import { createSkillStoreModal } from '@/features/SkillStore';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { useInterfaceDensity } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';
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
  pageBody: { paddingBlockStart: '0', paddingBlockEnd: '24px', paddingInline: '0' },
  // Title and one line of what connectors do on the left; search and the page
  // actions on the right, the primary Add last.
  pageHeader: {
    display: 'flex',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: '16px',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBlockStart: '32px',
    paddingBlockEnd: '8px',
    paddingInline: '12px',
  },
  pageSearch: { width: '240px' },
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
    paddingInline: '16px',
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
  /** Render as the page-level list a row opens a second-level detail from. */
  page?: boolean;
  selectedIdentifier?: string;
  viewMode: SkillViewMode;
}

const LeftPanel = memo<LeftPanelProps>(
  ({ fullWidth, onDeleteSelected, onSelect, page, selectedIdentifier, viewMode }) => {
    const { t } = useTranslation(['setting', 'tool']);
    const interfaceDensity = useInterfaceDensity();
    const [showAddConnector, setShowAddConnector] = useState(false);
    const [keyword, setKeyword] = useState('');

    const handleOpenStore = useCallback(() => {
      createSkillStoreModal();
    }, []);

    const isConnectorView = viewMode === 'connector';
    const { allowed: canCreate } = usePermission('create_content');
    // Adding a workspace connector follows the same member policy as editing one.
    const { canManage: canAddConnector, isPending: isPolicyPending } = useConnectorManageable();
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
        {
          desc: t('connectorMarket.add.browseStoreDesc'),
          icon: <Icon icon={Store} />,
          key: 'store',
          label: t('connectorMarket.add.browseStore'),
          onClick: handleOpenStore,
        },
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
                {t(isConnectorView ? 'skillView.connectorsDesc' : 'skillView.skillsDesc')}
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
          {isConnectorView && <ConnectorManagePolicy variant={'page'} />}
        </>
      );

      return (
        <SkillListVariantProvider value={'page'}>
          <div {...stylex.props(styles.pageBody)}>
            <SkillList
              keyword={keyword}
              renderHeader={renderHeader}
              viewMode={viewMode}
              onClearKeyword={() => setKeyword('')}
              onDeleteSelected={onDeleteSelected}
              onSelect={onSelect}
            />
          </div>
          <CustomConnectorModal
            open={showAddConnector}
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
              <Button
                aria-label={t('skillStore.title')}
                icon={<Icon icon={Store} />}
                size="small"
                onClick={handleOpenStore}
              />
            </div>
          </div>

          {isConnectorView && <ConnectorManagePolicy />}

          <div {...stylex.props(styles.body)}>
            <SkillList
              selectedIdentifier={selectedIdentifier}
              viewMode={viewMode}
              onDeleteSelected={onDeleteSelected}
              onSelect={onSelect}
            />
          </div>
        </div>
        <CustomConnectorModal open={showAddConnector} onClose={() => setShowAddConnector(false)} />
      </NavPanelDensityContext>
    );
  },
);

LeftPanel.displayName = 'SkillSettingsLeftPanel';

export default LeftPanel;
