'use client';

import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type SkillArgs } from '../types';

export const SkillInspector = memo<BuiltinInspectorProps<SkillArgs>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const label = t(ClaudeCodeApiName.Skill as any);
    const skillName = args?.skill || partialArgs?.skill;

    if (isArgumentsStreaming && !skillName) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
        {skillName && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{skillName}</span>
          </>
        )}
      </div>
    );
  },
);

SkillInspector.displayName = 'ClaudeCodeSkillInspector';
