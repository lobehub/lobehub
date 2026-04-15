'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivatedToolInfo, ActivateToolsParams, ActivateToolsState } from '../../../types';

const styles = createStaticStyles(({ css }) => ({
  notFoundHint: css`
    flex-shrink: 0;
    max-width: 100%;
    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
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
  const notFoundList = pluginState?.notFound ?? [];
  const requestedTools: ActivatedToolInfo[] =
    identifiers?.map((id) => ({ apiCount: 0, identifier: id, name: id })) ?? [];
  const visibleTools =
    activatedTools && activatedTools.length > 0 ? activatedTools : requestedTools;

  // Streaming / Loading: show identifiers from arguments
  if (isArgumentsStreaming || isLoading) {
    return (
      <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-activator.apiName.activateTools')}</span>
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

  // Finished: show activated tool names with avatars; surface notFound in the title row
  const hasNotFound = notFoundList.length > 0;
  const notFoundTitle = notFoundList.join(', ');

  return (
    <Flexbox
      allowShrink
      horizontal
      className={inspectorTextStyles.root}
      gap={8}
      style={{ flexWrap: 'wrap' }}
    >
      <span>{t('builtins.lobe-activator.apiName.activateTools')}</span>
      {hasNotFound && (
        <Tooltip title={notFoundTitle}>
          <Flexbox horizontal className={styles.notFoundHint} gap={4}>
            <Icon color={cssVar.colorWarning} icon={AlertTriangle} />
            <span>
              {t('builtins.lobe-activator.inspector.activateTools.notFoundCount', {
                count: notFoundList.length,
              })}
            </span>
          </Flexbox>
        </Tooltip>
      )}
      {visibleTools.length > 0 && (
        <span className={styles.tools}>
          {visibleTools.map((tool) => (
            <span className={styles.tool} key={tool.identifier}>
              {tool.avatar && <Avatar avatar={tool.avatar} size={18} title={tool.name} />}
              <span>{tool.name}</span>
            </span>
          ))}
        </span>
      )}
    </Flexbox>
  );
});

ActivateToolsInspector.displayName = 'ActivateToolsInspector';
