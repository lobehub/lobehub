import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';

import Arguments from '../Arguments';

interface FallbackArgumentRenderProps {
  content: string;
  requestArgs?: string;
  toolCallId: string;
  /** Tool message this result belongs to; enables pulling back a projected body. */
  toolMessageId?: string;
}

export const FallbackArgumentRender = memo<FallbackArgumentRenderProps>(
  ({ toolCallId, content, requestArgs, toolMessageId }) => {
    const { t } = useTranslation('plugin');

    // An empty body on a real tool message means the read path projected it
    // away, so fetch it. This component only mounts once the row is expanded,
    // which is the user asking to see the result — a conversation load leaves
    // every row collapsed and fetches nothing.
    const { isLoading, payload } = useToolResultPayload(toolMessageId, !content && !!toolMessageId);
    const body = payload?.content ?? content;

    // Parse and display result content
    const { data, language } = useMemo(() => {
      try {
        const parsed = JSON.parse(body || '');
        // If parsed result is a string, return it directly
        if (typeof parsed === 'string') {
          return { data: parsed, language: 'plaintext' };
        }
        return { data: JSON.stringify(parsed, null, 2), language: 'json' };
      } catch {
        return { data: body || '', language: 'plaintext' };
      }
    }, [body]);

    return (
      <Block id={toolCallId} variant={'outlined'} width={'100%'}>
        <Arguments arguments={requestArgs} />
        {(isLoading || body) && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <Flexbox paddingBlock={'8px 0'} paddingInline={16}>
              <Text>{t('debug.response')}</Text>
            </Flexbox>
          </>
        )}
        {isLoading && !body && (
          <Flexbox paddingBlock={8} paddingInline={16}>
            <Skeleton height={72} width={'100%'} />
          </Flexbox>
        )}
        {body && (
          <Highlighter
            language={language}
            variant={'filled'}
            style={{
              background: 'transparent',
              borderRadius: 0,
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {data}
          </Highlighter>
        )}
      </Block>
    );
  },
);
