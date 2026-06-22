'use client';

import { Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { FileArchive, Grid2x2Plus, Link, Store } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { CustomConnectorModal } from '@/features/Connectors';
import NavHeader from '@/features/NavHeader';
import { createSkillStoreModal } from '@/features/SkillStore';
import ImportFromGithubModal from '@/features/SkillStore/SkillList/ImportFromGithubModal';
import ImportFromUrlModal from '@/features/SkillStore/SkillList/ImportFromUrlModal';
import UploadSkillModal from '@/features/SkillStore/SkillList/UploadSkillModal';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, builtinToolSelectors } from '@/store/tool/selectors';

import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import SkillList, { type SkillViewMode } from './features/SkillList';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  detail: css`
    overflow-y: auto;
    flex: 1;
  `,
  left: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;

    width: 300px;
    min-width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  leftHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    height: 100%;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 6px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};

    transition: all 0.15s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  tabs: css`
    display: flex;
    gap: 2px;
    align-items: center;
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [searchParams] = useSearchParams();
  const queryViewMode: SkillViewMode =
    searchParams.get('tab') === 'skill' || searchParams.get('view') === 'skill'
      ? 'skill'
      : 'connector';
  const querySkillIdentifier = searchParams.get('skill');
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const [viewMode, setViewMode] = useState<SkillViewMode>(queryViewMode);
  const [showAddConnector, setShowAddConnector] = useState(false);
  const [showUrlModal, setUrlModal] = useState(false);
  const [showGithubModal, setGithubModal] = useState(false);
  const [showUploadModal, setUploadModal] = useState(false);

  // Data sources for auto-select
  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((tool) => tool.identifier),
    isEqual,
  );
  // Auto-select first item when view changes or on load
  useEffect(() => {
    setSelected(null);
  }, [viewMode]);

  useEffect(() => {
    setViewMode(queryViewMode);
  }, [queryViewMode]);

  useEffect(() => {
    if (selected) return;
    if (viewMode === 'skill' && querySkillIdentifier) return;
    if (viewMode === 'connector') {
      const firstTool = builtinTools.find(
        (tool) => !tool.hidden && installedBuiltinIds.includes(tool.identifier),
      );
      if (firstTool) {
        setSelected({ identifier: firstTool.identifier, type: 'builtin' });
      }
    } else {
      const firstSkill = builtinSkills[0];
      if (firstSkill) {
        setSelected({ identifier: firstSkill.identifier, type: 'builtin-skill' });
      }
    }
  }, [builtinTools, builtinSkills, installedBuiltinIds, querySkillIdentifier, selected, viewMode]);

  useEffect(() => {
    if (viewMode !== 'skill' || !querySkillIdentifier) return;

    const skill = [...marketAgentSkills, ...userAgentSkills].find(
      (item) => item.identifier === querySkillIdentifier,
    );
    if (skill) setSelected({ identifier: skill.id, type: 'agent-skill' });
  }, [marketAgentSkills, querySkillIdentifier, userAgentSkills, viewMode]);

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    setSelected({ identifier, type });
  };

  return (
    <>
      <NavHeader />
      <div className={styles.root}>
        {/* Left panel */}
        <div className={styles.left}>
          <div className={styles.leftHeader}>
            {/* Connector / Skill tab switcher */}
            <div className={styles.tabs}>
              <span
                className={`${styles.tab} ${viewMode === 'connector' ? styles.tabActive : ''}`}
                onClick={() => setViewMode('connector')}
              >
                {t('skillView.connectors', 'Connectors')}
              </span>
              <span
                className={`${styles.tab} ${viewMode === 'skill' ? styles.tabActive : ''}`}
                onClick={() => setViewMode('skill')}
              >
                {t('skillView.skills', 'Skills')}
              </span>
            </div>

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
                    onClick: () => setUrlModal(true),
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
                    onClick: () => setGithubModal(true),
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
                    onClick: () => setUploadModal(true),
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

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            <SkillList
              selectedIdentifier={selected?.identifier}
              viewMode={viewMode}
              onDeleteSelected={() => setSelected(null)}
              onSelect={handleSelect}
            />
          </div>
        </div>

        {/* Right: tool detail + permissions */}
        {selected && (
          <div className={styles.detail}>
            <SkillDetail
              identifier={selected.identifier}
              type={selected.type}
              onDelete={() => setSelected(null)}
            />
          </div>
        )}
      </div>
      <ImportFromUrlModal open={showUrlModal} onOpenChange={setUrlModal} />
      <ImportFromGithubModal open={showGithubModal} onOpenChange={setGithubModal} />
      <UploadSkillModal open={showUploadModal} onOpenChange={setUploadModal} />
      <CustomConnectorModal open={showAddConnector} onClose={() => setShowAddConnector(false)} />
    </>
  );
});

Page.displayName = 'SkillSettings';

export default Page;
