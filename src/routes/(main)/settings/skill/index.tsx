'use client';

import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import NavHeader from '@/features/NavHeader';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors, builtinToolSelectors } from '@/store/tool/selectors';

import LeftPanel from './features/LeftPanel';
import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import { type SkillViewMode } from './features/SkillList';

export interface SelectedTool {
  identifier: string;
  type: ToolDetailType;
}

const styles = createStaticStyles(({ css }) => ({
  detail: css`
    overflow-y: auto;
    flex: 1;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    height: 100%;
  `,
}));

const Page = memo(() => {
  const [searchParams] = useSearchParams();
  const queryViewMode: SkillViewMode =
    searchParams.get('tab') === 'skill' || searchParams.get('view') === 'skill'
      ? 'skill'
      : 'connector';
  const querySkillIdentifier = searchParams.get('skill');
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const [viewMode, setViewMode] = useState<SkillViewMode>(queryViewMode);

  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((tool) => tool.identifier),
    isEqual,
  );

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

  const handleSelect = (identifier: string, type: ToolDetailType) => {
    setSelected({ identifier, type });
  };

  return (
    <>
      <NavHeader />
      <div className={styles.root}>
        <LeftPanel
          selectedIdentifier={selected?.identifier}
          viewMode={viewMode}
          onDeleteSelected={() => setSelected(null)}
          onSelect={handleSelect}
          onViewModeChange={setViewMode}
        />

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
    </>
  );
});

Page.displayName = 'SkillSettings';

export default Page;
