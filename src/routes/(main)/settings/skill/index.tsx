'use client';

import { Button, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { PlusIcon, Store } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AddConnectorModal } from '@/features/Connectors';
import NavHeader from '@/features/NavHeader';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import SkillDetail, { type ToolDetailType } from './features/SkillDetail';
import SkillList from './features/SkillList';

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
    width: 300px;
    min-width: 260px;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  leftHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    height: 100%;
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [selected, setSelected] = useState<SelectedTool | null>(null);
  const [showAddConnector, setShowAddConnector] = useState(false);

  // Data sources for auto-select
  const builtinTools = useToolStore((s) => s.builtinTools, isEqual);
  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);
  const installedBuiltinIds = useToolStore(
    (s) => builtinToolSelectors.installedAllMetaList(s).map((t) => t.identifier),
    isEqual,
  );

  // Auto-select the first visible item on load
  useEffect(() => {
    if (selected) return;
    // 1. First installed builtin tool
    const firstTool = builtinTools.find(
      (t) => !t.hidden && installedBuiltinIds.includes(t.identifier),
    );
    if (firstTool) {
      setSelected({ identifier: firstTool.identifier, type: 'builtin' });
      return;
    }
    // 2. First builtin skill
    const firstSkill = builtinSkills[0];
    if (firstSkill) {
      setSelected({ identifier: firstSkill.identifier, type: 'builtin-skill' });
    }
  }, [builtinTools, builtinSkills, installedBuiltinIds, selected]);

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
        {/* Left: unified skill list */}
        <div className={styles.left}>
          <div className={styles.leftHeader}>
            <span style={{ fontWeight: 600 }}>{t('tab.skill')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {/* + opens "Add custom MCP connector" modal */}
              <Button
                icon={<Icon icon={PlusIcon} />}
                size="small"
                onClick={() => setShowAddConnector(true)}
              />
              {/* Skill store for built-in / community skills */}
              <Button icon={<Icon icon={Store} />} size="small" onClick={handleOpenStore}>
                {t('skillStore.button')}
              </Button>
            </div>
          </div>
          <div style={{ padding: '4px 8px' }}>
            <SkillList selectedIdentifier={selected?.identifier} onSelect={handleSelect} />
          </div>
        </div>

        {/* Right: tool detail + permissions */}
        {selected && (
          <div className={styles.detail}>
            <SkillDetail identifier={selected.identifier} type={selected.type} />
          </div>
        )}
      </div>

      <AddConnectorModal open={showAddConnector} onClose={() => setShowAddConnector(false)} />
    </>
  );
});

Page.displayName = 'SkillSettings';

export default Page;
