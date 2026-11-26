'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Import, Plus, RotateCw } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { densityTokens } from '@/styles/density.stylex';

import { getCatalogAddAction } from './catalogAddAction';
import { getPageSearchPlacement } from './pageHeaderLayout';
import type { SkillViewMode } from './SkillList';

const styles = stylex.create({
  // The Codex Plugins header: the title shares its row with search, the page
  // controls and the primary Add (last); one line of what the page does sits
  // 8px under both, so a long description never pushes the toolbar down.
  pageHeader: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: densityTokens['--lobe-density-gap'],
    paddingBlockStart: '32px',
    paddingBlockEnd: '8px',
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  // Mobile: the shell's top bar sits right above, so the title needs less air.
  pageHeaderCompact: { paddingBlockStart: '16px' },
  pageHeadRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: densityTokens['--lobe-density-section-gap'],
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // No radius token reaches a pill; the Codex search field and Add button are pills.
  pageSearch: { width: '240px' },
  // Mobile: a 240px field beside refresh and Add is ~390px of toolbar that
  // cannot wrap, wider than a 375px screen; the field takes its own row.
  pageSearchCompact: { width: '100%' },
  // SearchBar draws its border on the inner input box, so the pill goes there.
  pageSearchInput: { borderRadius: '999px' },
  // Disabled buttons swallow hover events; the wrapper anchors the tooltip.
  tooltipAnchor: { display: 'inline-flex' },
  pageTitle: {
    marginBlock: 0,
    fontSize: cssVar.fontSizeHeading3,
    fontWeight: 600,
    lineHeight: 1.3,
    color: cssVar.colorText,
  },
});

interface CatalogPageHeaderProps {
  compact?: boolean;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onRefresh: () => void;
  onSearch?: (value: string) => void;
  refreshing: boolean;
  toolbarExtra?: ReactNode;
  viewMode: SkillViewMode;
  visibility?: ConnectorVisibility;
}

const CatalogPageHeader = memo<CatalogPageHeaderProps>(
  ({
    compact,
    keyword,
    onKeywordChange,
    onRefresh,
    onSearch,
    refreshing,
    toolbarExtra,
    viewMode,
    visibility,
  }) => {
    const { t } = useTranslation(['setting', 'discover']);
    const [showAddConnector, setShowAddConnector] = useState(false);
    const { allowed: canCreate } = usePermission('create_content');
    const { canManage, isPending } = useConnectorManageable();
    const isConnectorView = viewMode !== 'skill';
    const isPrivateTab = visibility === 'private';
    const description = t(
      !isConnectorView
        ? 'skillView.skillsDesc'
        : isPrivateTab
          ? 'skillView.privateConnectorsDesc'
          : visibility
            ? 'skillView.workspaceConnectorsDesc'
            : 'skillView.connectorsDesc',
    );
    const add = getCatalogAddAction({
      canCreate,
      canManageShared: canManage,
      policyPending: isPending,
      viewMode,
      visibility,
    });
    const addAction =
      add.kind === 'customConnector' ? (
        <Tooltip title={add.disabledReason && t('tools.connectorFeedback.manageOnly')}>
          <span {...stylex.props(styles.tooltipAnchor)}>
            <Button
              disabled={add.disabled}
              icon={Plus}
              shape={'round'}
              type={'primary'}
              onClick={() => setShowAddConnector(true)}
            >
              {viewMode === 'mcp'
                ? t('apps.addMcp', { ns: 'discover' })
                : t('connectorMarket.add.custom')}
            </Button>
          </span>
        </Tooltip>
      ) : (
        <Button
          disabled={add.disabled}
          icon={Import}
          shape={'round'}
          type={'primary'}
          onClick={openSkillImportModal}
        >
          {t('agentSkillModal.title')}
        </Button>
      );
    const searchPlaceholder =
      viewMode === 'mcp'
        ? t('catalog.searchIn', { ns: 'discover', name: 'MCP' })
        : t(
            isConnectorView ? 'connectorMarket.search.placeholder' : 'skillView.search.placeholder',
          );

    const searchBelowTitle = getPageSearchPlacement(compact) === 'below-title';
    const search = (
      <SearchBar
        allowClear
        aria-label={searchPlaceholder}
        classNames={{ input: stylex.props(styles.pageSearchInput).className }}
        placeholder={searchPlaceholder}
        value={keyword}
        variant={'outlined'}
        className={
          stylex.props(searchBelowTitle ? styles.pageSearchCompact : styles.pageSearch).className
        }
        onInputChange={onKeywordChange}
        onSearch={onSearch}
      />
    );

    return (
      <>
        <div {...stylex.props(styles.pageHeader, compact && styles.pageHeaderCompact)}>
          <div {...stylex.props(styles.pageHeadRow)}>
            <h1 {...stylex.props(styles.pageTitle)}>
              {viewMode === 'mcp'
                ? t('tab.mcp', { ns: 'discover' })
                : t(isConnectorView ? 'skillView.connectors' : 'skillView.skills')}
            </h1>
            <Flexbox horizontal align={'center'} flex={'none'} gap={12}>
              {!searchBelowTitle && search}
              {/* The member policy governs the shared pool only */}
              {toolbarExtra}
              <ActionIcon
                aria-label={t('connectorMarket.refresh')}
                icon={RotateCw}
                loading={refreshing}
                title={t('connectorMarket.refresh')}
                onClick={onRefresh}
              />
              {addAction}
            </Flexbox>
          </div>
          {searchBelowTitle && search}
          <Text type={'secondary'}>
            {viewMode === 'mcp' ? t('apps.mcpDescription', { ns: 'discover' }) : description}
          </Text>
        </div>
        {showAddConnector && (
          <CustomConnectorModal
            open
            visibility={visibility}
            onClose={() => setShowAddConnector(false)}
          />
        )}
      </>
    );
  },
);

CatalogPageHeader.displayName = 'CatalogPageHeader';
export default CatalogPageHeader;
