import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cx } from 'antd-style';
import { TerminalIcon, WrenchIcon } from 'lucide-react';
import type { FC, MouseEvent } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';
import type { ActionTagCategory } from './types';

export interface ActionMentionProps {
  category: ActionTagCategory;
  /**
   * Render the tag as interactive (pointer cursor + hover affordance + a
   * "click to view" tooltip hint). Defaults to `!!onClick`; pass it explicitly
   * when the click is handled elsewhere (e.g. the editor's Lexical CLICK_COMMAND
   * rather than a React `onClick`).
   */
  clickable?: boolean;
  /**
   * The tag's own description (e.g. a project skill's frontmatter description).
   * Replaces the generic category description in the tooltip when present.
   */
  description?: string;
  label: string;
  onClick?: () => void;
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

export const ActionMention = memo<ActionMentionProps>(
  ({ category, label, description, clickable, onClick }) => {
    const { t } = useTranslation('editor');

    const categoryLabel = t(CATEGORY_I18N_KEY[category] as any);
    const categoryDescription = t(CATEGORY_TOOLTIP_I18N_KEY[category] as any);
    const IconComponent = CATEGORY_ICON[category];
    const styleKey = CATEGORY_STYLE_KEY[category];

    const isClickable = clickable ?? !!onClick;
    const tooltipDescription = description || categoryDescription;

    const handleClick = onClick
      ? (event: MouseEvent<HTMLSpanElement>) => {
          event.stopPropagation();
          onClick();
        }
      : undefined;

    return (
      <Tooltip
        title={
          <Flexbox gap={2}>
            <div style={{ fontWeight: 500 }}>{label}</div>
            <div style={{ opacity: 0.65 }}>{categoryLabel}</div>
            {tooltipDescription && <div>{tooltipDescription}</div>}
            {isClickable && (
              <div style={{ opacity: 0.65 }}>{t('actionTag.tooltip.clickToView')}</div>
            )}
          </Flexbox>
        }
      >
        <span
          className={cx(styles.actionTag, styles[styleKey], isClickable && styles.clickable)}
          onClick={handleClick}
        >
          <Icon icon={IconComponent} size={14} />
          <span className={styles.actionTagLabel}>{label}</span>
        </span>
      </Tooltip>
    );
  },
);

ActionMention.displayName = 'ActionMention';
