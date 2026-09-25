import { type ToolIntervention } from '@lobechat/types';
import { Block, Highlighter, Icon } from '@lobehub/ui';
import { Tabs, type TabsProps } from '@lobehub/ui/base-ui';
import {
  BracesIcon,
  CircleAlertIcon,
  FunctionSquareIcon,
  HandIcon,
  MessageSquareCodeIcon,
  SquareArrowDownIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';

interface DebugProps {
  apiName: string;
  identifier: string;
  intervention?: ToolIntervention;
  requestArgs?: string;
  result?: { content: string | null; error?: any; state?: any };
  toolCallId: string;
  /** Tool message this panel inspects; lets it pull back a projected payload. */
  toolMessageId?: string;
  type?: string;
}

const Debug = memo<DebugProps>(
  ({ result, requestArgs, toolCallId, apiName, identifier, type, intervention, toolMessageId }) => {
    const { t } = useTranslation('plugin');

    // This panel IS the raw viewer, and it only mounts once the user toggles it
    // on — so whenever the read path projected this tool, fetch what it dropped.
    const projected = useToolResultPayload(toolMessageId, !!toolMessageId);
    const rawResult = projected.payload
      ? { ...result, content: projected.payload.content, state: projected.payload.pluginState }
      : result;

    const params = useMemo(() => {
      try {
        return JSON.stringify(JSON.parse(requestArgs || ''), null, 2);
      } catch {
        return '';
      }
    }, [requestArgs]);

    const functionCall = useMemo(() => {
      return {
        apiName,
        arguments: requestArgs,
        id: toolCallId,
        identifier,
        type,
      };
    }, [requestArgs, toolCallId, apiName, identifier, type]);

    const isJsonResult =
      rawResult?.content?.trim().startsWith('{') || rawResult?.content?.trim().startsWith('[');

    const items: TabsProps['items'] = useMemo(
      () => [
        {
          children: (
            <Highlighter
              language={'json'}
              style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
              variant={'filled'}
            >
              {params}
            </Highlighter>
          ),
          icon: <Icon icon={MessageSquareCodeIcon} />,
          key: 'arguments',
          label: t('debug.arguments'),
        },
        {
          children: (
            <Highlighter
              language={isJsonResult ? 'json' : 'plaintext'}
              style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
              variant={'filled'}
            >
              {isJsonResult
                ? JSON.stringify(rawResult?.content, null, 2)
                : rawResult?.content || ''}
            </Highlighter>
          ),
          icon: <Icon icon={SquareArrowDownIcon} />,
          key: 'response',
          label: t('debug.response'),
        },
        {
          children: (
            <Highlighter
              language={'json'}
              style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
              variant={'filled'}
            >
              {JSON.stringify(functionCall, null, 2)}
            </Highlighter>
          ),
          icon: <Icon icon={FunctionSquareIcon} />,
          key: 'function_call',
          label: t('debug.function_call'),
        },
        {
          children: (
            <Highlighter
              language={'json'}
              style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
              variant={'filled'}
            >
              {JSON.stringify(rawResult?.state, null, 2)}
            </Highlighter>
          ),
          icon: <Icon icon={BracesIcon} />,
          key: 'pluginState',
          label: t('debug.pluginState'),
        },
        {
          children: (
            <Highlighter
              language={'json'}
              style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
              variant={'filled'}
            >
              {JSON.stringify(intervention, null, 2)}
            </Highlighter>
          ),
          icon: <Icon icon={HandIcon} />,
          key: 'intervention',
          label: t('debug.intervention'),
        },
        ...(result?.error
          ? [
              {
                children: (
                  <Highlighter
                    language={'json'}
                    style={{ background: 'transparent', borderRadius: 0, height: '100%' }}
                    variant={'filled'}
                  >
                    {JSON.stringify(result.error, null, 2)}
                  </Highlighter>
                ),
                icon: <Icon icon={CircleAlertIcon} />,
                key: 'error',
                label: t('debug.error'),
              },
            ]
          : []),
      ],
      [
        functionCall,
        isJsonResult,
        params,
        rawResult?.content,
        result?.error,
        rawResult?.state,
        intervention,
        t,
      ],
    );

    return (
      <Block style={{ overflow: 'hidden' }} variant={'outlined'}>
        <Tabs
          items={items}
          orientation={'vertical'}
          size={'middle'}
          styles={{
            list: {
              borderRadius: 0,
            },
            panel: {
              flex: 'auto',
              height: 300,
              minHeight: 0,
              minWidth: 0,
              padding: 0,
            },
            tab: {
              justifyContent: 'flex-start',
              textAlign: 'start',
            },
          }}
        />
      </Block>
    );
  },
);

export default Debug;
