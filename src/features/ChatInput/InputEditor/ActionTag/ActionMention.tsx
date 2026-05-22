import { Icon, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cx } from 'antd-style';
import { TerminalIcon, WrenchIcon } from 'lucide-react';
import type { FC } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';
import type { ActionTagCategory } from './types';

export interface ActionMentionProps {
  category: ActionTagCategory;
  label: string;
}

const CATEGORY_ICON: Record<ActionTagCategory, FC<any>> = {
  agentSkill: SkillsIcon,
  command: TerminalIcon,
  projectSkill: SkillsIcon,
  skill: SkillsIcon,
  tool: WrenchIcon,
};

const CATEGORY_I18N_KEY: Record<ActionTagCategory, string> = {
  agentSkill: 'actionTag.category.agentSkill',
  command: 'actionTag.category.command',
  projectSkill: 'actionTag.category.projectSkill',
  skill: 'actionTag.category.skill',
  tool: 'actionTag.category.tool',
};

const CATEGORY_TOOLTIP_I18N_KEY: Record<ActionTagCategory, string> = {
  agentSkill: 'actionTag.tooltip.agentSkill',
  command: 'actionTag.tooltip.command',
  projectSkill: 'actionTag.tooltip.projectSkill',
  skill: 'actionTag.tooltip.skill',
  tool: 'actionTag.tooltip.tool',
};

const CATEGORY_STYLE_KEY: Record<
  ActionTagCategory,
  'agentSkillTag' | 'commandTag' | 'projectSkillTag' | 'skillTag' | 'toolTag'
> = {
  agentSkill: 'agentSkillTag',
  command: 'commandTag',
  projectSkill: 'projectSkillTag',
  skill: 'skillTag',
  tool: 'toolTag',
};

export const ActionMention = memo<ActionMentionProps>(({ category, label }) => {
  const { t } = useTranslation('editor');

  const categoryLabel = t(CATEGORY_I18N_KEY[category] as any);
  const categoryDescription = t(CATEGORY_TOOLTIP_I18N_KEY[category] as any);
  const IconComponent = CATEGORY_ICON[category];
  const styleKey = CATEGORY_STYLE_KEY[category];

  return (
    <Tooltip
      title={
        <div>
          <div style={{ fontWeight: 500 }}>{label}</div>
          <div>{categoryLabel}</div>
          <div>{categoryDescription}</div>
        </div>
      }
    >
      <span className={cx(styles.actionTag, styles[styleKey])}>
        <Icon icon={IconComponent} size={14} />
        <span className={styles.actionTagLabel}>{label}</span>
      </span>
    </Tooltip>
  );
});

ActionMention.displayName = 'ActionMention';
