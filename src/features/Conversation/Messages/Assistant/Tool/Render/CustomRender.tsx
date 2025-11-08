import { UIChatMessage } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { App } from 'antd';
import { Edit3Icon, PlayCircleIcon } from 'lucide-react';
import { parse } from 'partial-json';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import PluginResult from '@/features/Conversation/Messages/Assistant/Tool/Inspector/PluginResult';
import PluginRender from '@/features/PluginsUI/Render';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import Arguments from './Arguments';
import KeyValueEditor from './KeyValueEditor';

const safeParseJson = (str: string): Record<string, any> => {
  try {
    const obj = parse(str);
    return typeof obj === 'object' && obj !== null ? obj : {};
  } catch {
    return {};
  }
};

interface CustomRenderProps extends UIChatMessage {
  requestArgs?: string;
  setShowPluginRender: (value: boolean) => void;
  showPluginRender: boolean;
}

const CustomRender = memo<CustomRenderProps>(
  ({
    id,
    content,
    pluginState,
    plugin,
    requestArgs,
    showPluginRender,
    setShowPluginRender,
    pluginError,
    tool_call_id,
  }) => {
    const { t } = useTranslation(['tool', 'common']);
    const [loading] = useChatStore((s) => [chatSelectors.isPluginApiInvoking(id)(s)]);
    const [isEditing, setIsEditing] = useState(false);
    const { message } = App.useApp();
    const [updatePluginArguments, reInvokeToolMessage] = useChatStore((s) => [
      s.updatePluginArguments,
      s.reInvokeToolMessage,
    ]);
    const handleCancel = useCallback(() => {
      setIsEditing(false);
    }, []);

    const handleFinish = useCallback(
      async (editedObject: Record<string, any>) => {
        if (!id) return;

        try {
          const newArgsString = JSON.stringify(editedObject, null, 2);

          if (newArgsString !== requestArgs) {
            await updatePluginArguments(id, editedObject, true);
            await reInvokeToolMessage(id);
          }
          setIsEditing(false);
        } catch (error) {
          console.error('Error stringifying arguments:', error);
          message.error(t('updateArgs.stringifyError'));
        }
      },
      [requestArgs, id],
    );

    useEffect(() => {
      if (!plugin?.type || loading) return;

      setShowPluginRender(!['default', 'mcp'].includes(plugin?.type));
    }, [plugin?.type, loading]);

    if (loading) return <Arguments arguments={requestArgs} shine />;

    if (showPluginRender)
      return (
        <Flexbox gap={12} id={id} width={'100%'}>
          <PluginRender
            arguments={plugin?.arguments}
            content={content}
            id={id}
            identifier={plugin?.identifier}
            loading={loading}
            payload={plugin}
            pluginError={pluginError}
            pluginState={pluginState}
            type={plugin?.type}
          />
        </Flexbox>
      );

    if (isEditing)
      return (
        <KeyValueEditor
          initialValue={safeParseJson(requestArgs || '')}
          onCancel={handleCancel}
          onFinish={handleFinish}
        />
      );

    return (
      <Flexbox gap={12} id={id} width={'100%'}>
        <Arguments
          actions={
            <>
              <ActionIcon
                icon={Edit3Icon}
                onClick={() => {
                  setIsEditing(true);
                }}
                size={'small'}
                title={t('edit', { ns: 'common' })}
              />
              <ActionIcon
                icon={PlayCircleIcon}
                onClick={async () => {
                  await reInvokeToolMessage(id);
                }}
                size={'small'}
                title={t('run', { ns: 'common' })}
              />
            </>
          }
          arguments={requestArgs}
        />
        {tool_call_id && <PluginResult toolCallId={tool_call_id} variant={'outlined'} />}
      </Flexbox>
    );
  },
);

CustomRender.displayName = 'CustomRender';

export default CustomRender;
