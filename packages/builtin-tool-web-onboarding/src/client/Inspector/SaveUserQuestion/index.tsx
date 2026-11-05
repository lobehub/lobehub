'use client';

import type { BuiltinInspectorProps, SaveUserQuestionInput } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { inspectorChipStyles } from '../_styles';

export const SaveUserQuestionInspector = memo<
  BuiltinInspectorProps<SaveUserQuestionInput, Record<string, unknown>>
>(({ args, partialArgs, isArgumentsStreaming, isLoading }) => {
  const { t } = useTranslation('plugin');

  const data = (args ?? partialArgs ?? {}) as SaveUserQuestionInput;
  const agentName = data.agentName?.trim();
  const agentEmoji = data.agentEmoji?.trim();
  const fullName = data.fullName?.trim();
  const interestsCount =
    (Array.isArray(data.interests) ? data.interests.length : 0) +
    (Array.isArray(data.customInterests) ? data.customInterests.length : 0);
  const hasAnyField = Boolean(agentName || agentEmoji || fullName || interestsCount > 0);

  if (isArgumentsStreaming && !hasAnyField) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-web-onboarding.apiName.saveUserQuestion')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root} style={{ flexWrap: 'wrap', gap: 4 }}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-web-onboarding.apiName.saveUserQuestion')}
      </span>
      {(agentName || agentEmoji) && (
        <span {...stylex.props(inspectorChipStyles.chip)}>
          {agentEmoji && <span {...stylex.props(inspectorChipStyles.emoji)}>{agentEmoji}</span>}
          {agentName && <span>{agentName}</span>}
        </span>
      )}
      {fullName && <span {...stylex.props(inspectorChipStyles.chip)}>{fullName}</span>}
      {interestsCount > 0 && (
        <span {...stylex.props(inspectorChipStyles.meta)}>
          {t('builtins.lobe-web-onboarding.inspector.interests', { count: interestsCount })}
        </span>
      )}
    </div>
  );
});

SaveUserQuestionInspector.displayName = 'SaveUserQuestionInspector';

export default SaveUserQuestionInspector;
