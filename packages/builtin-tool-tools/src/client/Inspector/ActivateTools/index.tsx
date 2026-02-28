'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { Avatar } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivateToolsParams, ActivateToolsState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  tool: css`
    display: inline-flex;
    gap: 2px;
    align-items: center;

    font-size: 14px;
    line-height: 18px;
    color: ${cssVar.colorText};
  `,
  tools: css`
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;

    margin-inline-start: 4px;
  `,
}));

export const ActivateToolsInspector = memo<
  BuiltinInspectorProps<ActivateToolsParams, ActivateToolsState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');

  const identifiers = args?.identifiers || partialArgs?.identifiers;
  const activatedTools = pluginState?.activatedTools;

  // Streaming / Loading: show identifiers from arguments
  if (isArgumentsStreaming || isLoading) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-tools.apiName.activateTools')}</span>
        {identifiers && identifiers.length > 0 && (
          <span className={styles.tools}>
            {identifiers.map((id) => (
              <code className={styles.tool} key={id}>
                {id}
              </code>
            ))}
          </span>
        )}
      </div>
    );
  }

  // Finished: show activated tool names with avatars
  return (
    <div className={inspectorTextStyles.root}>
      <span>{t('builtins.lobe-tools.apiName.activateTools')}</span>
      {activatedTools && activatedTools.length > 0 && (
        <span className={styles.tools}>
          {activatedTools.map((tool) => (
            <span className={styles.tool} key={tool.identifier}>
              {tool.avatar && <Avatar avatar={tool.avatar} size={18} title={tool.name} />}
              <span>{tool.name}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
});

ActivateToolsInspector.displayName = 'ActivateToolsInspector';
