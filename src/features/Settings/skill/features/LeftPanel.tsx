'use client';

import { Button, DropdownMenu, Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileArchive, Grid2x2Plus, Link, Store } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { createSkillStoreModal } from '@/features/SkillStore';
import { openImportFromGithubModal } from '@/features/SkillStore/SkillList/ImportFromGithubModal';
import { openImportFromUrlModal } from '@/features/SkillStore/SkillList/ImportFromUrlModal';
import { openUploadSkillModal } from '@/features/SkillStore/SkillList/UploadSkillModal';
import { useConnectorManageable } from '@/hooks/useConnectorManagePolicy';

import ConnectorManagePolicy from './ConnectorManagePolicy';
import { type ToolDetailType } from './SkillDetail';
import SkillList, { type SkillViewMode } from './SkillList';
import { SkillListVariantProvider } from './SkillListRow';

const styles = stylex.create({
  body: { overflowY: 'auto', flex: '1', paddingBlock: '4px', paddingInline: '8px' },
  pageBody: { paddingBlockStart: '0', paddingBlockEnd: '24px', paddingInline: '0' },
  pageHeader: {
    display: 'flex',
    flexShrink: 0,
    gap: '16px',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBlockStart: '24px',
    paddingBlockEnd: '16px',
    paddingInline: '12px',
  },
  header: {
    display: 'flex',
    flexShrink: 0,
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '42px',
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
    const [showAddConnector, setShowAddConnector] = useState(false);

    const handleOpenStore = useCallback(() => {
      createSkillStoreModal();
    }, []);

    const isConnectorView = viewMode === 'connector';
    // Adding a workspace connector follows the same member policy as editing one.
    const { canManage: canAddConnector, isPending: isPolicyPending } = useConnectorManageable();
    const addConnectorTitle = t('connector.add.title', {
      defaultValue: 'Add Custom Connector',
      ns: 'tool',
    });
    const isConnectorPage = page && isConnectorView;

    if (isConnectorPage)
      return (
        <SkillListVariantProvider value={'page'}>
          <div {...stylex.props(styles.pageHeader)}>
            <Flexbox gap={4}>
              <Text as={'h1'} fontSize={20} style={{ margin: 0 }} weight={600}>
                {t('skillView.connectors', 'Connectors')}
              </Text>
              <Text type={'secondary'}>{t('skillView.connectorsDesc')}</Text>
            </Flexbox>
            <Flexbox horizontal flex={'none'} gap={8}>
              <Tooltip title={t('skillStore.title')}>
                <Button
                  aria-label={t('skillStore.title')}
                  icon={<Icon icon={Store} />}
                  onClick={handleOpenStore}
                />
              </Tooltip>
              <Tooltip
                title={
                  canAddConnector || isPolicyPending
                    ? undefined
                    : t('tools.connectorFeedback.manageOnly')
                }
              >
                {/* Disabled buttons swallow hover events; the wrapper anchors the tooltip. */}
                <span {...stylex.props(styles.tooltipAnchor)}>
                  <Button
                    disabled={!canAddConnector}
                    icon={Grid2x2Plus}
                    onClick={() => setShowAddConnector(true)}
                  >
                    {addConnectorTitle}
                  </Button>
                </span>
              </Tooltip>
            </Flexbox>
          </div>
          <ConnectorManagePolicy variant={'page'} />
          <div {...stylex.props(styles.pageBody)}>
            <SkillList
              viewMode={viewMode}
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

    return (
      <>
        <div
          className={stylex.props(styles.root).className}
          style={fullWidth ? { borderInlineEnd: 'none', width: '100%' } : undefined}
        >
          <div {...stylex.props(styles.header)}>
            <Text strong style={{ fontSize: 14 }}>
              {isConnectorView
                ? t('skillView.connectors', 'Connectors')
                : t('skillView.skills', 'Skills')}
            </Text>

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
                      disabled={!canAddConnector}
                      icon={Grid2x2Plus}
                      size="small"
                      onClick={() => setShowAddConnector(true)}
                    />
                  </span>
                </Tooltip>
              ) : (
                // Skill view: import a skill from a URL, GitHub, or a zip upload.
                <DropdownMenu
                  nativeButton={false}
                  placement="bottomRight"
                  items={[
                    {
                      icon: <Icon icon={Link} />,
                      key: 'importUrl',
                      label: (
                        <Flexbox gap={2}>
                          <span>{t('tab.importFromUrl')}</span>
                          <Text style={{ fontSize: 12 }} type="secondary">
                            {t('tab.importFromUrl.desc')}
                          </Text>
                        </Flexbox>
                      ),
                      onClick: () => openImportFromUrlModal(),
                    },
                    {
                      icon: <Icon icon={GithubIcon} />,
                      key: 'importGithub',
                      label: (
                        <Flexbox gap={2}>
                          <span>{t('tab.importFromGithub')}</span>
                          <Text style={{ fontSize: 12 }} type="secondary">
                            {t('tab.importFromGithub.desc')}
                          </Text>
                        </Flexbox>
                      ),
                      onClick: () => openImportFromGithubModal(),
                    },
                    {
                      icon: <Icon icon={FileArchive} />,
                      key: 'uploadZip',
                      label: (
                        <Flexbox gap={2}>
                          <span>{t('tab.uploadZip')}</span>
                          <Text style={{ fontSize: 12 }} type="secondary">
                            {t('tab.uploadZip.desc')}
                          </Text>
                        </Flexbox>
                      ),
                      onClick: () => openUploadSkillModal(),
                    },
                  ]}
                >
                  <Button icon={Grid2x2Plus} size="small" />
                </DropdownMenu>
              )}
              <Button icon={<Icon icon={Store} />} size="small" onClick={handleOpenStore} />
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
      </>
    );
  },
);

LeftPanel.displayName = 'SkillSettingsLeftPanel';

export default LeftPanel;
