'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cssVar, cx, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { InspectSkillParams, InspectSkillState } from '../../../types';

export const InspectSkillInspector = memo<
  BuiltinInspectorProps<InspectSkillParams, InspectSkillState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifier = args?.identifier || partialArgs?.identifier;
  const displayName = pluginState?.name || identifier;

  if (isArgumentsStreaming && !identifier) {
    return (
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-skill-store.apiName.inspectSkill')}
        </span>
      </div>
    );
  }

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-skill-store.apiName.inspectSkill')}:{' '}
      </span>
      {displayName && <span className={highlightTextStyles.primary}>{displayName}</span>}
      {!isLoading && !isArgumentsStreaming && pluginState && (
        <Text
          as={'span'}
          color={cssVar.colorTextDescription}
          fontSize={12}
          style={{ marginInlineStart: 4 }}
        >
          (
          {t('builtins.lobe-skill-store.inspector.requirements', {
            credentials: pluginState.credentials?.length ?? 0,
            hosts: pluginState.endpoints?.length ?? 0,
          })}
          )
        </Text>
      )}
    </div>
  );
});

InspectSkillInspector.displayName = 'InspectSkillInspector';
