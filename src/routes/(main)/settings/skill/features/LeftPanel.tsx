'use client';

import { Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { FileArchive, Grid2x2Plus, Link, Store } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CustomConnectorModal } from '@/features/Connectors';
import { createSkillStoreModal } from '@/features/SkillStore';
import { openImportFromGithubModal } from '@/features/SkillStore/SkillList/ImportFromGithubModal';
import { openImportFromUrlModal } from '@/features/SkillStore/SkillList/ImportFromUrlModal';
import { openUploadSkillModal } from '@/features/SkillStore/SkillList/UploadSkillModal';

import { type ToolDetailType } from './SkillDetail';
import SkillList, { type SkillViewMode } from './SkillList';

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 4px;
    padding-inline: 8px;
  `,
  header: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    height: 42px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;

    width: 300px;
    min-width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface LeftPanelProps {
  onDeleteSelected: () => void;
  onSelect: (identifier: string, type: ToolDetailType) => void;
  onViewModeChange: (mode: SkillViewMode) => void;
  selectedIdentifier?: string;
  viewMode: SkillViewMode;
}

const LeftPanel = memo<LeftPanelProps>(
  ({ onDeleteSelected, onSelect, onViewModeChange, selectedIdentifier, viewMode }) => {
    const { t } = useTranslation('setting');
    const [showAddConnector, setShowAddConnector] = useState(false);

    const handleOpenStore = useCallback(() => {
      createSkillStoreModal();
    }, []);

    return (
      <>
        <div className={styles.root}>
          <div className={styles.header}>
            <Tabs
              activeKey={viewMode}
              size="small"
              style={{ width: 'auto' }}
              items={[
                { key: 'connector', label: t('skillView.connectors', 'Connectors') },
                { key: 'skill', label: t('skillView.skills', 'Skills') },
              ]}
              onChange={(key) => onViewModeChange(key as SkillViewMode)}
            />

            <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
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
                  { type: 'divider' as const },
                  {
                    icon: <Icon icon={Grid2x2Plus} />,
                    key: 'addConnector',
                    label: (
                      <Flexbox gap={2}>
                        <span>
                          {t('connector.add.title', {
                            defaultValue: 'Add Custom Connector',
                            ns: 'tool',
                          })}
                        </span>
                      </Flexbox>
                    ),
                    onClick: () => setShowAddConnector(true),
                  },
                ]}
              >
                <Button icon={Grid2x2Plus} size="small" />
              </DropdownMenu>
              <Button icon={<Icon icon={Store} />} size="small" onClick={handleOpenStore} />
            </div>
          </div>

          <div className={styles.body}>
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
