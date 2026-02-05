import { Block, Flexbox, Highlighter, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import Arguments from '../Arguments';

interface FallbackArgumentRenderProps {
  content: string;
  requestArgs?: string;
  toolCallId: string;
}

export const FallbackArgumentRender = memo<FallbackArgumentRenderProps>(
  ({ toolCallId, content, requestArgs }) => {
    const { t } = useTranslation('plugin');

    // Parse and display result content
    const { data, language } = useMemo(() => {
      try {
        const parsed = JSON.parse(content || '');
        // If parsed result is a string, return it directly
        if (typeof parsed === 'string') {
          return { data: parsed, language: 'plaintext' };
        }
        return { data: JSON.stringify(parsed, null, 2), language: 'json' };
      } catch {
        return { data: content || '', language: 'plaintext' };
      }
    }, [content]);

    // Default render: show arguments and result
    return (
      <Block id={toolCallId} variant={'outlined'} width={'100%'}>
        <Arguments arguments={requestArgs} />
        {content && (
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
