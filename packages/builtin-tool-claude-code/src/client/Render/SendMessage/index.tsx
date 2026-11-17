'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleCheckBig } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SendMessageArgs, SendMessageResult } from '../../../types';

const parseResult = (content: unknown): SendMessageResult | undefined => {
  if (content && typeof content === 'object') return content as SendMessageResult;
  if (typeof content !== 'string' || !content.trim()) return undefined;
  try {
    return JSON.parse(content) as SendMessageResult;
  } catch {
    return undefined;
  }
};

const styles = stylex.create({
  bodyBox: {
    overflow: 'hidden',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  container: { paddingBlock: '4px' },
  status: { paddingInline: '4px' },
});

/**
 * Unfolded body of a message to a subagent. The inspector header above it
 * already reads "Message subagent: <summary>", so the card shows only what
 * the header cannot: the full message and whether it was delivered.
 */
const SendMessage = memo<BuiltinRenderProps<SendMessageArgs>>(({ args, content }) => {
  const { t } = useTranslation('plugin');

  const body = args?.message ?? args?.content;

  const result = parseResult(content);
  // The tool's own confirmation embeds the opaque recipient id ("… to <id> at
  // its next tool round"), meaningless to a user — show a localized generic
  // status instead of echoing that raw string.
  const delivered = result?.success === true;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      {body && (
        <Flexbox className={stylex.props(styles.bodyBox).className}>
          <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
            {body}
          </Markdown>
        </Flexbox>
      )}

      {delivered && (
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.status).className}
          gap={6}
        >
          <Icon icon={CircleCheckBig} size={'small'} style={{ color: cssVar.colorSuccess }} />
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {t('builtins.lobe-claude-code.sendMessage.sent')}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

SendMessage.displayName = 'ClaudeCodeSendMessage';

export default SendMessage;
