'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodexMcpToolArgs, CodexMcpToolState } from './mcpToolUtils';
import {
  formatMcpInput,
  formatMcpOutput,
  getMcpErrorText,
  getMcpInput,
  getMcpResultText,
  getMcpToolName,
} from './mcpToolUtils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  sectionLabel: css`
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const McpToolRender = memo<BuiltinRenderProps<CodexMcpToolArgs, CodexMcpToolState, string>>(
  ({ args, content, pluginState }) => {
    const { t } = useTranslation('plugin');
    const toolName = getMcpToolName(args, pluginState);
    const input = formatMcpInput(getMcpInput(args, pluginState), toolName);
    const output = formatMcpOutput(getMcpResultText(content, pluginState, args), toolName);
    const error = getMcpErrorText(pluginState, args);

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
