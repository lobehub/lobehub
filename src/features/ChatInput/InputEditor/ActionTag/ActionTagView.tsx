import { Tag, Tooltip } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';
import type { ActionTagCategory } from './types';

export interface ActionTagViewProps {
  category: ActionTagCategory;
  label: string;
}

const CATEGORY_COLOR: Record<ActionTagCategory, string> = {
  command: 'purple',
  skill: 'blue',
  tool: 'gold',
};

const CATEGORY_I18N_KEY: Record<ActionTagCategory, string> = {
  command: 'actionTag.category.command',
  skill: 'actionTag.category.skill',
  tool: 'actionTag.category.tool',
};

const CATEGORY_TOOLTIP_I18N_KEY: Record<ActionTagCategory, string> = {
  command: 'actionTag.tooltip.command',
  skill: 'actionTag.tooltip.skill',
  tool: 'actionTag.tooltip.tool',
};

const CATEGORY_STYLE_KEY: Record<ActionTagCategory, 'commandTag' | 'skillTag' | 'toolTag'> = {
  command: 'commandTag',
  skill: 'skillTag',
  tool: 'toolTag',
};

export const ActionTagView = memo<ActionTagViewProps>(({ category, label }) => {
  const { t } = useTranslation('editor');

  const categoryLabel = t(CATEGORY_I18N_KEY[category] as any);
  const categoryDescription = t(CATEGORY_TOOLTIP_I18N_KEY[category] as any);
  const color = CATEGORY_COLOR[category];
  const styleKey = CATEGORY_STYLE_KEY[category];

  return (
    <span className={cx(styles[styleKey])}>
      <Tooltip
        title={
          <div>
            <div style={{ fontWeight: 500 }}>{label}</div>
            <div>{categoryLabel}</div>
            <div>{categoryDescription}</div>
          </div>
        }
      >
        <Tag color={color} variant="filled">
          {label}
        </Tag>
      </Tooltip>
    </span>
  );
});

ActionTagView.displayName = 'ActionTagView';
