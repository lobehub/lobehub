import { Block, Flexbox, Highlighter } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { memo, useMemo, useState } from 'react';
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
    const [requested, setRequested] = useState(false);
    const { isLoading, payload } = useToolResultPayload(toolMessageId, requested);

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

    // An empty body on a real tool message is ambiguous: the tool may have
    // returned nothing, or the read path may have projected the body away. Offer
    // to fetch rather than guess — and never fetch on mount, which would undo
    // the projection for every conversation load.
    const canLoadStored = !body && !!toolMessageId && !requested;

    return (
      <Block id={toolCallId} variant={'outlined'} width={'100%'}>
        <Arguments arguments={requestArgs} />
        {canLoadStored && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <Flexbox align={'flex-start'} paddingBlock={8} paddingInline={16}>
              <Button size={'small'} onClick={() => setRequested(true)}>
                {t('debug.loadStoredResult')}
              </Button>
            </Flexbox>
          </>
        )}
        {requested && isLoading && (
          <Flexbox paddingBlock={8} paddingInline={16}>
            <Skeleton height={80} width={'100%'} />
          </Flexbox>
        )}
        {body && (
          <>
            <Divider style={{ marginBlock: 0 }} />
            <Flexbox paddingBlock={'8px 0'} paddingInline={16}>
              <Text>{t('debug.response')}</Text>
            </Flexbox>
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
          </>
        )}
      </Block>
    );
  },
);
