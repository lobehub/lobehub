'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
    case 'device': {
      return t('builtins.lobe-skills.apiName.activateDeviceSkill');
    }
    case 'project': {
      return t('builtins.lobe-skills.apiName.activateProjectSkill');
    }
    default: {
      return t('builtins.lobe-skills.apiName.activateSkill');
    }
  }
};

const styles = stylex.create({
  chip: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    maxWidth: '100%',
    marginInlineStart: '6px',
    paddingBlock: '3px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    background: cssVar.colorBgContainer,
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
        <div className={inspectorTextStyles.root}>
          <span className={shinyTextStyles.shinyText}>{label}</span>
        </div>
      );

    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>{label}:</span>
        <span {...stylex.props(styles.chip)}>
          <SkillsIcon className={stylex.props(styles.skillIcon).className} size={12} />
          <span {...stylex.props(styles.skillName)}>{displayName}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx(isLoading && shinyTextStyles.shinyText)}>{label}:</span>
      {displayName && (
        <span {...stylex.props(styles.chip)}>
          <SkillsIcon className={stylex.props(styles.skillIcon).className} size={12} />
          <span {...stylex.props(styles.skillName)}>{displayName}</span>
        </span>
      )}
    </div>
  );
});

ActivateSkillInspector.displayName = 'ActivateSkillInspector';
