'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { ActionIcon, Button, DropdownMenu, Flexbox, Icon, SearchBar, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, Grid2x2Plus, Import, Plus, RotateCw, Store } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { openSkillImportModal } from '@/features/SkillStore/SkillImportModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';
import { usePermission } from '@/hooks/usePermission';
import { densityTokens } from '@/styles/density.stylex';

import { getPageSearchPlacement } from './pageHeaderLayout';
import type { SkillViewMode } from './SkillList';

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
  onBrowseStore: () => void;
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
    onBrowseStore,
    onKeywordChange,
    onRefresh,
    onSearch,
    refreshing,
    toolbarExtra,
    viewMode,
    visibility,
  }) => {
    const { t } = useTranslation('setting');
    const [showAddConnector, setShowAddConnector] = useState(false);
    const { allowed: canCreate } = usePermission('create_content');
    const { canManage, isPending } = useConnectorManageable();
    const isConnectorView = viewMode === 'connector';
    const isPrivateTab = visibility === 'private';
    const canAddConnector = isPrivateTab || canManage;
    const isPolicyPending = !isPrivateTab && isPending;
    const description = t(
      !isConnectorView
        ? 'skillView.skillsDesc'
        : isPrivateTab
          ? 'skillView.privateConnectorsDesc'
          : visibility
            ? 'skillView.workspaceConnectorsDesc'
            : 'skillView.connectorsDesc',
    );
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
              onClick: onBrowseStore,
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
              {t(isConnectorView ? 'skillView.connectors' : 'skillView.skills')}
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
              <DropdownMenu items={addItems} placement={'bottomRight'}>
                <Button
                  className={stylex.props(styles.addTrigger).className}
                  icon={Plus}
                  shape={'round'}
                  type={'primary'}
                >
                  {t('connectorMarket.add')}
                  <Icon icon={ChevronDown} size={14} />
                </Button>
              </DropdownMenu>
            </Flexbox>
          </div>
          {searchBelowTitle && search}
          <Text type={'secondary'}>{description}</Text>
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
