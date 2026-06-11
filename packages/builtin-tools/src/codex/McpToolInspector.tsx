'use client';

import { LINEAR_TOOL_NAMES, LinearInspector } from '@lobechat/shared-tool-ui/inspectors';
import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from 'antd-style';
import type { ComponentType } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodexMcpToolArgs, CodexMcpToolState } from './mcpToolUtils';
import {
  getCodexLinearMcpApiName,
  getMcpInputRecord,
  getMcpServer,
  getMcpToolName,
} from './mcpToolUtils';

const LINEAR_TOOL_NAME_SET = new Set<string>(LINEAR_TOOL_NAMES);
const SharedLinearInspector = LinearInspector as ComponentType<
  BuiltinInspectorProps<Record<string, unknown>>
>;

const McpToolInspector = memo<BuiltinInspectorProps<CodexMcpToolArgs, CodexMcpToolState>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const label = t('builtins.codex.apiName.mcp_tool_call', {
      defaultValue: 'Call MCP tool',
    });
    const server = getMcpServer(args, pluginState) || getMcpServer(partialArgs);
    const tool = getMcpToolName(args, pluginState) || getMcpToolName(partialArgs);
    const linearApiName = getCodexLinearMcpApiName(tool);

    if (LINEAR_TOOL_NAME_SET.has(linearApiName)) {
      return (
        <SharedLinearInspector
          apiName={linearApiName}
          args={getMcpInputRecord(args, pluginState) || {}}
          identifier={'codex'}
          isArgumentsStreaming={isArgumentsStreaming}
          isLoading={isLoading}
          partialArgs={getMcpInputRecord(partialArgs) || {}}
          pluginState={pluginState}
        />
      );
    }

    const target = [server, tool].filter(Boolean).join(' > ');

    if (isArgumentsStreaming && !target) {
      return <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>{label}</div>;
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{label}</span>
        {target && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{target}</span>
          </>
        )}
      </div>
    );
  },
);

McpToolInspector.displayName = 'CodexMcpToolInspector';

export default McpToolInspector;
