'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { RunSkillParams, RunSkillState } from '../../../types';

export const RunSkillInspector = memo<BuiltinInspectorProps<RunSkillParams, RunSkillState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const name = args?.name || partialArgs?.name || '';
    const activatedName = pluginState?.name;

    if (isArgumentsStreaming) {
      if (!name)
        return (
          <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
            <span>{t('builtins.lobe-skills.apiName.runSkill')}</span>
          </div>
        );

      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-skills.apiName.runSkill')}: </span>
          <span>{name}</span>
        </div>
      );
    }

    return (
      <div className={cx(inspectorTextStyles.root, isLoading && shinyTextStyles.shinyText)}>
        <span>
          <span>{t('builtins.lobe-skills.apiName.runSkill')}: </span>
          <span className={highlightTextStyles.primary}>{activatedName || name}</span>
        </span>
      </div>
    );
  },
);

RunSkillInspector.displayName = 'RunSkillInspector';
