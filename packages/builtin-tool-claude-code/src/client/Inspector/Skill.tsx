'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ClaudeCodeApiName, type SkillArgs } from '../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};
  `,
  skillIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  skillName: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
          <span className={styles.chip}>
            <SkillsIcon className={styles.skillIcon} size={12} />
            <span className={styles.skillName}>{skillName}</span>
          </span>
        )}
      </div>
    );
  },
);

SkillInspector.displayName = 'ClaudeCodeSkillInspector';
