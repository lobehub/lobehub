import { type ToolIntervention } from '@lobechat/types';
import { type TabsProps } from '@lobehub/ui';
import { Block, Highlighter, Icon, Tabs } from '@lobehub/ui';
import {
  BracesIcon,
  FunctionSquareIcon,
  HandIcon,
  MessageSquareCodeIcon,
  SquareArrowDownIcon,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface DebugProps {
  apiName: string;
  identifier: string;
  intervention?: ToolIntervention;
  requestArgs?: string;
  result?: { content: string | null; error?: any; state?: any };
  toolCallId: string;
  type?: string;
}

const Debug = memo<DebugProps>(
  ({ result, requestArgs, toolCallId, apiName, identifier, type, intervention }) => {
    const { t } = useTranslation('plugin');

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
      result?.content?.trim().startsWith('{') || result?.content?.trim().startsWith('[');

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
              {isJsonResult ? JSON.stringify(result?.content, null, 2) : result?.content || ''}
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
              {JSON.stringify(result?.state, null, 2)}
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
      ],
      [functionCall, isJsonResult, params, result?.content, result?.state, intervention, t],
    );

    return (
      <Block variant={'outlined'}>
        <Tabs
          compact
          items={items}
          tabPlacement={'start'}
          styles={{
            content: {
              height: 300,
              padding: 0,
            },
          }}
        />
      </Block>
    );
  },
);

export default Debug;
