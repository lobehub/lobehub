'use client';

import { Button, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { Store } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

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
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const [viewMode, setViewMode] = useState<SkillViewMode>('connector');

  // Data sources for auto-select
  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((tool) => tool.identifier),
    isEqual,
  );

  // Auto-select first item when view changes or on load
  useEffect(() => {
    setSelected(null);
  }, [viewMode]);

  useEffect(() => {
    if (selected) return;
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
  }, [builtinTools, builtinSkills, installedBuiltinIds, selected, viewMode]);

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

            <div style={{ display: 'flex', gap: 6 }}>
              <Button icon={<Icon icon={Store} />} size="small" onClick={handleOpenStore} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            <SkillList
              selectedIdentifier={selected?.identifier}
              viewMode={viewMode}
              onSelect={handleSelect}
            />
          </div>
        </div>

        {/* Right: tool detail + permissions */}
        {selected && (
          <div className={styles.detail}>
            <SkillDetail identifier={selected.identifier} type={selected.type} />
          </div>
        )}
      </div>
    </>
  );
});

Page.displayName = 'SkillSettings';

export default Page;
