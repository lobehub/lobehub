'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type SkillArgs } from '../../types';

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    marginInlineStart: '6px',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderRadius: '999px',
    background: cssVar.colorFillTertiary,
  },
  skillIcon: { flexShrink: 0, color: cssVar.colorTextDescription },
  skillName: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '12px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export const SkillInspector = memo<BuiltinInspectorProps<SkillArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.Skill as any);
    const skillName = args?.skill || partialArgs?.skill;

    if (isArgumentsStreaming && !skillName) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {skillName && (
          <span {...stylex.props(styles.chip)}>
            <SkillsIcon className={stylex.props(styles.skillIcon).className} size={12} />
            <span {...stylex.props(styles.skillName)}>{skillName}</span>
          </span>
        )}
      </div>
    );
  },
);

SkillInspector.displayName = 'ClaudeCodeSkillInspector';
