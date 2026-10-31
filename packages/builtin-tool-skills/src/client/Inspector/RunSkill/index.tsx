'use client';

import { AGENT_SKILLS_IDENTIFIER_PREFIX } from '@lobechat/const';
import { type BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivateSkillParams, ActivateSkillSource, ActivateSkillState } from '../../../types';

type SkillLabelKey =
  | 'builtins.lobe-skills.apiName.activateAgentSkill'
  | 'builtins.lobe-skills.apiName.activateDeviceSkill'
  | 'builtins.lobe-skills.apiName.activateProjectSkill'
  | 'builtins.lobe-skills.apiName.activateSkill';

/**
 * Resolve the inspector label key. State-side `source` is the authority once the
 * tool result has streamed in; while args are still streaming we only have the
 * raw `name` to go on, so detect agent skills via the identifier prefix as a
 * best-effort fallback. Filesystem skills can't be inferred from the bare name
 * (no prefix), so they show "Activate Skill" until the result lands.
 */
const resolveLabelKey = (
  source: ActivateSkillSource | undefined,
  rawName: string | undefined,
): SkillLabelKey => {
  const effective: ActivateSkillSource =
    source ?? (rawName?.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX) ? 'agent' : 'builtin');

  switch (effective) {
    case 'agent': {
      return 'builtins.lobe-skills.apiName.activateAgentSkill';
    }
    case 'device': {
      return 'builtins.lobe-skills.apiName.activateDeviceSkill';
    }
    case 'project': {
      return 'builtins.lobe-skills.apiName.activateProjectSkill';
    }
    default: {
      return 'builtins.lobe-skills.apiName.activateSkill';
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

export const RunSkillInspector = memo<
  BuiltinInspectorProps<ActivateSkillParams, ActivateSkillState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const name = args?.name || partialArgs?.name;
  const displayName = pluginState?.title || pluginState?.name || name;
  const label = t(resolveLabelKey(pluginState?.source, name));

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

RunSkillInspector.displayName = 'RunSkillInspector';
