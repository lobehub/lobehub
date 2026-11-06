'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodexCollabToolArgs, CodexCollabToolState } from './collabToolUtils';
import {
  formatCollabStatus,
  getCollabAgentEntries,
  getCollabPrompt,
  getCollabStatusTone,
} from './collabToolUtils';

const styles = stylex.create({
  agentHeader: { fontSize: '12px', color: cssVar.colorTextSecondary },
  agentRow: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  promptBox: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  sectionLabel: { marginBlockEnd: '4px', fontSize: '12px', color: cssVar.colorTextSecondary },
  statusDot: {
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  statusDotError: { backgroundColor: cssVar.colorError, backgroundImage: 'none' },
  statusDotProcessing: { backgroundColor: cssVar.colorInfo, backgroundImage: 'none' },
  statusDotSuccess: { backgroundColor: cssVar.colorSuccess, backgroundImage: 'none' },
});

const STATUS_DOT_STYLE = {
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
          <Text className={stylex.props(styles.sectionLabel).className}>
            {t('builtins.codex.collabTool.instruction', { defaultValue: 'Instruction' })}
          </Text>
          <Flexbox className={stylex.props(styles.promptBox).className}>
            <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
              {prompt}
            </Markdown>
          </Flexbox>
        </div>
      )}
      {agents.length > 0 && (
        <div>
          <Text className={stylex.props(styles.sectionLabel).className}>
            {t('builtins.codex.collabTool.agents', { defaultValue: 'Subagents' })}
          </Text>
          <Flexbox gap={8}>
            {agents.map((agent, index) => (
              <Flexbox className={stylex.props(styles.agentRow).className} gap={4} key={agent.id}>
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.agentHeader).className}
                  gap={6}
                >
                  <span
                    {...stylex.props(
                      styles.statusDot,
                      STATUS_DOT_STYLE[getCollabStatusTone(agent.status)],
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
