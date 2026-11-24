'use client';

import type {
  BuiltinInspectorProps,
  ChannelAskUserParams,
  ChannelDirectoryPage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelMessagePersonParams,
  ChannelPeoplePage,
  ChannelReacted,
  ChannelReactParams,
  ChannelSendMessageParams,
  ChannelSentMessage,
  ChannelSentPersonMessage,
  ChannelThreadPage,
} from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import { ChannelApiName } from '../../types';

const ChannelInspector = memo<
  BuiltinInspectorProps<unknown, ChannelHistoryPage | ChannelHistoryMessageDetail>
>(({ apiName, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>
        {t(
          apiName === ChannelApiName.readMessage
            ? 'builtins.lobe-channel.apiName.readMessage'
            : 'builtins.lobe-channel.apiName.readMessages',
        )}
      </span>
      {!loading && pluginState && (
        <span>
          {'messages' in pluginState
            ? t('builtins.lobe-channel.messageCount', { count: pluginState.messages.length })
            : `#${pluginState.message.sequence}`}
        </span>
      )}
    </div>
  );
});
ChannelInspector.displayName = 'ChannelInspector';

const ListChannelsInspector = memo<BuiltinInspectorProps<unknown, ChannelDirectoryPage>>(
  ({ isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-channel.apiName.listChannels')}</span>
        {!loading && pluginState && (
          <span>
            {t('builtins.lobe-channel.channelCount', { count: pluginState.channels.length })}
          </span>
        )}
      </div>
    );
  },
);
ListChannelsInspector.displayName = 'ChannelListChannelsInspector';

const SendMessageInspector = memo<
  BuiltinInspectorProps<ChannelSendMessageParams, ChannelSentMessage>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-channel.apiName.sendMessage')}</span>
      {!loading && pluginState && (
        <span>{pluginState.agents.map(({ name }) => `@${name}`).join(' ')}</span>
      )}
    </div>
  );
});
SendMessageInspector.displayName = 'ChannelSendMessageInspector';

const ListPeopleInspector = memo<BuiltinInspectorProps<unknown, ChannelPeoplePage>>(
  ({ isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-channel.apiName.listPeople')}</span>
        {!loading && pluginState && (
          <span>
            {t('builtins.lobe-channel.peopleCount', { count: pluginState.people.length })}
          </span>
        )}
      </div>
    );
  },
);
ListPeopleInspector.displayName = 'ChannelListPeopleInspector';

const MessagePersonInspector = memo<
  BuiltinInspectorProps<ChannelMessagePersonParams, ChannelSentPersonMessage>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const loading = isArgumentsStreaming || isLoading;
  return (
    <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-channel.apiName.messagePerson')}</span>
      {!loading && pluginState && <span>{pluginState.person.name}</span>}
    </div>
  );
});
MessagePersonInspector.displayName = 'ChannelMessagePersonInspector';

/** The question being asked, so the step reads as what the Agent wants to know. */
const AskUserInspector = memo<BuiltinInspectorProps<ChannelAskUserParams, unknown>>(
  ({ args, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    const question = args?.questions?.[0]?.question;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>{t('builtins.lobe-channel.apiName.askUser')}</span>
        {question && <span>{question}</span>}
      </div>
    );
  },
);
AskUserInspector.displayName = 'ChannelAskUserInspector';

const THREAD_API_NAMES = [
  ChannelApiName.createThread,
  ChannelApiName.listThreads,
  ChannelApiName.steerThread,
  ChannelApiName.stopThread,
  ChannelApiName.unwatchThreads,
  ChannelApiName.watchThreads,
] as const;

/** Thread actions: the action, and for a listing how many Threads it found. */
const ThreadInspector = memo<BuiltinInspectorProps<unknown, unknown>>(
  ({ apiName, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    const threads =
      pluginState && typeof pluginState === 'object' && 'threads' in pluginState
        ? (pluginState as ChannelThreadPage).threads
        : undefined;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>
          {t(`builtins.lobe-channel.apiName.${apiName as (typeof THREAD_API_NAMES)[number]}`)}
        </span>
        {!loading && threads && (
          <span>{t('builtins.lobe-channel.threadCount', { count: threads.length })}</span>
        )}
      </div>
    );
  },
);
ThreadInspector.displayName = 'ChannelThreadInspector';

const ReactionInspector = memo<BuiltinInspectorProps<ChannelReactParams, ChannelReacted>>(
  ({ apiName, args, isArgumentsStreaming, isLoading }) => {
    const { t } = useTranslation('plugin');
    const loading = isArgumentsStreaming || isLoading;
    return (
      <div className={cx(inspectorTextStyles.root, loading && shinyTextStyles.shinyText)}>
        <span>
          {t(
            apiName === ChannelApiName.removeReaction
              ? 'builtins.lobe-channel.apiName.removeReaction'
              : 'builtins.lobe-channel.apiName.addReaction',
          )}
        </span>
        {args?.emoji && <span>{args.emoji}</span>}
      </div>
    );
  },
);
ReactionInspector.displayName = 'ChannelReactionInspector';

export const ChannelInspectors = {
  [ChannelApiName.addReaction]: ReactionInspector,
  [ChannelApiName.removeReaction]: ReactionInspector,
  ...Object.fromEntries(THREAD_API_NAMES.map((name) => [name, ThreadInspector])),
  [ChannelApiName.askUser]: AskUserInspector,
  [ChannelApiName.listChannels]: ListChannelsInspector,
  [ChannelApiName.listPeople]: ListPeopleInspector,
  [ChannelApiName.messagePerson]: MessagePersonInspector,
  [ChannelApiName.readMessage]: ChannelInspector,
  [ChannelApiName.readMessages]: ChannelInspector,
  [ChannelApiName.sendMessage]: SendMessageInspector,
};
