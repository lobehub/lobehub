'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles, cx } from 'antd-style';
import { type TFunction } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivateSkillParams, ActivateSkillSource, ActivateSkillState } from '../../../types';

/**
 * `t` is invoked with literal keys per branch so i18next's typed-key map can
 * still validate the call site.
 */
const resolveLabel = (t: TFunction<'plugin'>, source: ActivateSkillSource | undefined): string => {
  switch (source) {
    case 'agent': {
      return t('builtins.lobe-skills.apiName.activateAgentSkill');
    }
    case 'project': {
      return t('builtins.lobe-skills.apiName.activateProjectSkill');
    }
    default: {
      return t('builtins.lobe-skills.apiName.activateSkill');
    }
  }
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
    max-width: 100%;
    margin-inline-start: 6px;
    padding-block: 3px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    background: ${cssVar.colorBgContainer};
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

export const ActivateSkillInspector = memo<
  BuiltinInspectorProps<ActivateSkillParams, ActivateSkillState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const name = args?.name || partialArgs?.name;
  const displayName = pluginState?.title || pluginState?.name || name;
  const label = resolveLabel(t, pluginState?.source);

  if (isArgumentsStreaming) {
    if (!displayName)
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{label}</span>
        </div>
      );

    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{label}:</span>
        <span className={styles.chip}>
          <SkillsIcon className={styles.skillIcon} size={12} />
          <span className={styles.skillName}>{displayName}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
      <span>{label}:</span>
      {displayName && (
        <span className={styles.chip}>
          <SkillsIcon className={styles.skillIcon} size={12} />
          <span className={styles.skillName}>{displayName}</span>
        </span>
      )}
    </div>
  );
});

ActivateSkillInspector.displayName = 'ActivateSkillInspector';
