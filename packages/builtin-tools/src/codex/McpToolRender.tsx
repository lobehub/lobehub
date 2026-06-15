'use client';

import { LINEAR_TOOL_NAMES } from '@lobechat/shared-tool-ui/inspectors';
import { LinearRender } from '@lobechat/shared-tool-ui/renders';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { ComponentType } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodexMcpToolArgs, CodexMcpToolState } from './mcpToolUtils';
import {
  formatMcpInput,
  formatMcpOutput,
  getCodexLinearMcpApiName,
  getMcpErrorText,
  getMcpInput,
  getMcpInputRecord,
  getMcpResultText,
  getMcpServer,
  getMcpToolName,
} from './mcpToolUtils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionLabel: css`
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const LINEAR_TOOL_NAME_SET = new Set<string>([...LINEAR_TOOL_NAMES, 'fetch', 'search']);
const SharedLinearRender = LinearRender as ComponentType<
  BuiltinRenderProps<Record<string, unknown>, unknown, string>
>;

const McpToolRender = memo<BuiltinRenderProps<CodexMcpToolArgs, CodexMcpToolState, string>>(
  ({ args, content, messageId, pluginState, toolCallId }) => {
    const { t } = useTranslation('plugin');
    const server = getMcpServer(args, pluginState);
    const toolName = getMcpToolName(args, pluginState);
    const inputRecord = getMcpInputRecord(args, pluginState);
    const resultText = getMcpResultText(content, pluginState, args);
    const error = getMcpErrorText(pluginState, args);
    const linearApiName = getCodexLinearMcpApiName({
      input: inputRecord,
      server,
      toolName,
    });

    if (LINEAR_TOOL_NAME_SET.has(linearApiName)) {
      return (
        <SharedLinearRender
          apiName={linearApiName}
          args={inputRecord || {}}
          content={resultText}
          identifier={'codex'}
          messageId={messageId}
          pluginError={error}
          pluginState={pluginState}
          toolCallId={toolCallId}
        />
      );
    }

    const input = formatMcpInput(getMcpInput(args, pluginState), toolName);
    const output = formatMcpOutput(resultText, toolName);

    if (!input && !output && !error) return null;

    return (
      <Flexbox gap={12}>
        {input && (
          <div>
            <Text className={styles.sectionLabel}>
              {t('builtins.codex.mcpTool.input', { defaultValue: 'Input' })}
            </Text>
            <Highlighter
              wrap
              language={input.language}
              showLanguage={input.language !== 'text'}
              style={{ maxHeight: 220, overflow: 'auto', paddingInline: 8 }}
              variant={'outlined'}
            >
              {input.text}
            </Highlighter>
          </div>
        )}
        {output && (
          <div>
            <Text className={styles.sectionLabel}>
              {t('builtins.codex.mcpTool.result', { defaultValue: 'Result' })}
            </Text>
            <Highlighter
              wrap
              language={output.language}
              showLanguage={output.language !== 'text'}
              style={{ maxHeight: 360, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {output.text}
            </Highlighter>
          </div>
        )}
        {error && (
          <div>
            <Text className={styles.sectionLabel} style={{ color: cssVar.colorError }}>
              {t('builtins.codex.mcpTool.error', { defaultValue: 'Error' })}
            </Text>
            <Highlighter
              wrap
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 220, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {error}
            </Highlighter>
          </div>
        )}
      </Flexbox>
    );
  },
);

McpToolRender.displayName = 'CodexMcpToolRender';

export default McpToolRender;
