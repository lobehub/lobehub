'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 4px;
  `,
  label: css`
    margin-block-end: 4px;
    padding-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  promptBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillTertiary};
  `,
  resultBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

/**
 * Render for CC's `Agent` (subagent-spawn) tool.
 *
 * The Inspector row already shows `[icon] subagent_type [chip: description]`,
 * so this view skips the header and goes straight to the two blocks the
 * Inspector can't fit: the full `prompt` and the subagent's closing summary
 * (`content`) — both as Markdown because CC routinely passes multi-paragraph
 * or code-fenced prompts and the summary is prose. Each block is labelled
 * since the two Markdown bubbles are otherwise indistinguishable once the
 * subagent's reply happens to use the same tone as the prompt.
 *
 * Note: subagent internal turns are persisted as a separate Thread (linked
 * via `metadata.sourceToolCallId`) by the executor — this render does NOT
 * replay those; it only surfaces the request/response pair that belongs to
 * THIS tool call.
 */
const Agent = memo<BuiltinRenderProps<AgentArgs, unknown, string>>(({ args, content }) => {
  const { t } = useTranslation('plugin');
  const prompt = args?.prompt?.trim();
  const result = typeof content === 'string' ? content.trim() : '';

  if (!prompt && !result) return null;

  return (
    <Flexbox className={styles.container} gap={12}>
      {prompt && (
        <Flexbox>
          <Text className={styles.label}>{t('builtins.lobe-claude-code.agent.instruction')}</Text>
          <Flexbox className={styles.promptBox}>
            <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
              {prompt}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}

      {result && (
        <Flexbox>
          <Text className={styles.label}>{t('builtins.lobe-claude-code.agent.result')}</Text>
          <Flexbox className={styles.resultBox}>
            <Markdown style={{ maxHeight: 320, overflow: 'auto' }} variant={'chat'}>
              {result}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

Agent.displayName = 'ClaudeCodeAgent';

export default Agent;
