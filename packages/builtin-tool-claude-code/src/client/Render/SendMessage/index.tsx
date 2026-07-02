'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleCheckBig, SendHorizontal } from 'lucide-react';
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

const styles = createStaticStyles(({ css, cssVar }) => ({
  bodyBox: css`
    overflow: hidden;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  container: css`
    padding-block: 4px;
  `,
  header: css`
    padding-inline: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  status: css`
    padding-inline: 4px;
  `,
}));

const SendMessage = memo<BuiltinRenderProps<SendMessageArgs>>(({ args, content }) => {
  const { t } = useTranslation('plugin');

  const body = args?.message ?? args?.content;
  const summary = args?.summary?.trim();

  const result = parseResult(content);
  // The tool's own confirmation embeds the opaque recipient id ("… to <id> at
  // its next tool round"), meaningless to a user — show a localized generic
  // status instead of echoing that raw string.
  const delivered = result?.success === true;

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Icon icon={SendHorizontal} size={'small'} />
        <Text ellipsis strong>
          {summary || t('builtins.lobe-claude-code.sendMessage.title')}
        </Text>
      </Flexbox>

      {body && (
        <Flexbox className={styles.bodyBox}>
          <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
            {body}
          </Markdown>
        </Flexbox>
      )}

      {delivered && (
        <Flexbox horizontal align={'center'} className={styles.status} gap={6}>
          <Icon icon={CircleCheckBig} size={'small'} style={{ color: cssVar.colorSuccess }} />
          <Text style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {t('builtins.lobe-claude-code.sendMessage.queued')}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
});

SendMessage.displayName = 'ClaudeCodeSendMessage';

export default SendMessage;
