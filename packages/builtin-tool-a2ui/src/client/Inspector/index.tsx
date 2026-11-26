'use client';

import { inspectorTextStyles, shinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { A2uiApiName, type RenderUIParams, type RenderUIState } from '../../types';

export const RenderUIInspector = memo<BuiltinInspectorProps<RenderUIParams, RenderUIState>>(
  ({ isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const title = pluginState?.surface?.title;
    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-a2ui.apiName.renderUI')}
        </span>
        {title ? <span>：{title}</span> : null}
      </div>
    );
  },
);

RenderUIInspector.displayName = 'A2uiRenderUIInspector';

export const A2uiInspectors: Record<string, BuiltinInspector> = {
  [A2uiApiName.renderUI]: RenderUIInspector as BuiltinInspector,
};
