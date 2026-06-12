'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodexCollabToolArgs, CodexCollabToolState } from './collabToolUtils';
import {
  formatCollabStatus,
  getCollabAgentEntries,
  getCollabPrompt,
  getCollabStatusTone,
} from './collabToolUtils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  agentHeader: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  agentRow: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  promptBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillTertiary};
  `,
  sectionLabel: css`
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  statusDot: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  statusDotError: css`
    background: ${cssVar.colorError};
  `,
  statusDotProcessing: css`
    background: ${cssVar.colorInfo};
  `,
  statusDotSuccess: css`
    background: ${cssVar.colorSuccess};
  `,
}));

const STATUS_DOT_CLASS = {
  error: styles.statusDotError,
  muted: undefined,
  processing: styles.statusDotProcessing,
  success: styles.statusDotSuccess,
};

const CollabToolRender = memo<
  BuiltinRenderProps<CodexCollabToolArgs, CodexCollabToolState, string>
>(({ args, pluginState }) => {
  const { t } = useTranslation('plugin');
  const prompt = getCollabPrompt(args, pluginState);
  const agents = getCollabAgentEntries(args, pluginState);

  if (!prompt && agents.length === 0) return null;

  return (
    <Flexbox gap={12}>
      {prompt && (
        <div>
          <Text className={styles.sectionLabel}>
            {t('builtins.codex.collabTool.instruction', { defaultValue: 'Instruction' })}
          </Text>
          <Flexbox className={styles.promptBox}>
            <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
              {prompt}
            </Markdown>
          </Flexbox>
        </div>
      )}
      {agents.length > 0 && (
        <div>
          <Text className={styles.sectionLabel}>
            {t('builtins.codex.collabTool.agents', { defaultValue: 'Subagents' })}
          </Text>
          <Flexbox gap={8}>
            {agents.map((agent, index) => (
              <Flexbox className={styles.agentRow} gap={4} key={agent.id}>
                <Flexbox horizontal align={'center'} className={styles.agentHeader} gap={6}>
                  <span
                    className={cx(
                      styles.statusDot,
                      STATUS_DOT_CLASS[getCollabStatusTone(agent.status)],
                    )}
                  />
                  <span>
                    {t('builtins.codex.collabTool.agentLabel', {
                      defaultValue: 'Subagent {{index}}',
                      index: index + 1,
                    })}
                  </span>
                  {agent.status && <span>· {formatCollabStatus(agent.status)}</span>}
                </Flexbox>
                {agent.message && (
                  <Markdown style={{ maxHeight: 320, overflow: 'auto' }} variant={'chat'}>
                    {agent.message}
                  </Markdown>
                )}
              </Flexbox>
            ))}
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
});

CollabToolRender.displayName = 'CodexCollabToolRender';

export default CollabToolRender;
