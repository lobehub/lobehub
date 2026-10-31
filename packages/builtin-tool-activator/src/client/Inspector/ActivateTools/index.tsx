'use client';

import { type BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivatedToolInfo, ActivateToolsParams, ActivateToolsState } from '../../../types';

const styles = stylex.create({
  notFoundHint: { flexShrink: 0, maxWidth: '100%', fontSize: '12px', color: cssVar.colorWarning },
  tool: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: '0',
    paddingBlock: '2px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '999px',
    fontSize: '12px',
    color: cssVar.colorText,
    background: cssVar.colorFillTertiary,
  },
  toolName: { overflow: 'hidden', minWidth: '0', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tools: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: '4px',
    alignItems: 'center',
    marginInlineStart: '4px',
  },
});

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
      <div className={inspectorTextStyles.root}>
        <span className={shinyTextStyles.shinyText}>
          {t('builtins.lobe-activator.apiName.activateTools')}
        </span>
        {identifiers && identifiers.length > 0 && (
          <span {...stylex.props(styles.tools)}>
            {identifiers.map((id) => (
              <span {...stylex.props(styles.tool)} key={id}>
                <span {...stylex.props(styles.toolName)}>{id}</span>
              </span>
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
          <Flexbox horizontal className={stylex.props(styles.notFoundHint).className} gap={4}>
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
        <span {...stylex.props(styles.tools)}>
          {visibleTools.map((tool) => (
            <span {...stylex.props(styles.tool)} key={tool.identifier}>
              {tool.avatar && <Avatar avatar={tool.avatar} size={14} title={tool.name} />}
              <span {...stylex.props(styles.toolName)}>{tool.name}</span>
            </span>
          ))}
        </span>
      )}
    </Flexbox>
  );
});

ActivateToolsInspector.displayName = 'ActivateToolsInspector';
