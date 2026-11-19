'use client';

import { Tabs } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import { MARKETPLACE_INSTALLED_SKILLS_PATH, MARKETPLACE_SKILL_PATH } from './paths';
import { pillTabClassNames } from './pillTabs';

export type SkillView = 'discover' | 'installed';

const SKILL_VIEW_PATHS: Record<SkillView, string> = {
  discover: MARKETPLACE_SKILL_PATH,
  installed: MARKETPLACE_INSTALLED_SKILLS_PATH,
};

const styles = stylex.create({
  root: { flexShrink: 0 },
  // Under the installed list header: aligns with the header's 12px inset, and
  // its 8px bottom + 12px give the Codex 20px from description to tabs.
  inset: { paddingBlockStart: '12px', paddingInline: '12px' },
});

interface SkillViewTabsProps {
  active: SkillView;
  /** Indent to the list page header (installed page); the catalog column needs none. */
  inset?: boolean;
}

/**
 * Switches the Marketplace Skills entry between the public catalog
 * (`/marketplace/skill`) and the installed skills management page
 * (`/marketplace/skill/installed`, formerly `/settings/skill`).
 * With the market disabled only the installed view exists, so no tabs render.
 */
const SkillViewTabs = memo<SkillViewTabsProps>(({ active, inset }) => {
  const { t } = useTranslation('discover');
  const navigate = useWorkspaceAwareNavigate();
  const { showMarket } = useServerConfigStore(featureFlagsSelectors);

  const items = useMemo(
    () => [
      { key: 'discover', label: t('skillView.discover') },
      { key: 'installed', label: t('skillView.installed') },
    ],
    [t],
  );

  if (!showMarket) return null;

  return (
    <div {...stylex.props(styles.root, inset && styles.inset)}>
      <Tabs
        activeKey={active}
        classNames={pillTabClassNames}
        items={items}
        size={'middle'}
        variant={'rounded'}
        onChange={(key) => {
          if (key === active) return;
          navigate(SKILL_VIEW_PATHS[key as SkillView]);
        }}
      />
    </div>
  );
});

SkillViewTabs.displayName = 'MarketplaceSkillViewTabs';

export default SkillViewTabs;
