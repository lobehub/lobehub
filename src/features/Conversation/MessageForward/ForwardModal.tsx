'use client';

import { type StoreApiWithSelector } from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  SearchBar,
  Text,
  TextArea,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { getForwardedMessageText } from '@/store/chat/slices/forward/helpers';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import {
  contextSelectors,
  type ConversationStore,
  messageStateSelectors,
  Provider,
  useConversationStore,
} from '../store';
import SelectCircle from './SelectCircle';
import { useForwardMessages } from './useForwardMessages';
import { useForwardTargets } from './useForwardTargets';

const styles = stylex.create({
  body: { blockSize: '460px' },
  divider: {
    alignSelf: 'stretch',
    inlineSize: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  list: { overflowY: 'auto', flex: '1', marginInline: '-4px', paddingInline: '4px' },
  preview: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  previewLines: { overflowY: 'auto', flex: '1', paddingBlock: '12px', paddingInline: '12px' },
  note: { backgroundColor: 'transparent', backgroundImage: 'none' },
  noteDivider: {
    blockSize: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  previewLine: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  previewMore: { paddingBlockStart: '2px', fontSize: '12px', color: cssVar.colorTextTertiary },
  row: {
    cursor: 'pointer',
    minBlockSize: '44px',
    paddingBlock: '6px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusLG,
    transition: `background-color 0.1s ${cssVar.motionEaseInOut}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  rowSelected: { backgroundColor: cssVar.colorFillQuaternary },
});

const ForwardModalContent = memo(() => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [note, setNote] = useState('');
  const currentAgentId = useConversationStore(contextSelectors.agentId);
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const { candidates, keyword, selectedIds, setKeyword, targets, toggle } = useForwardTargets(
    agents,
    currentAgentId,
  );
  const forwardMessages = useForwardMessages();

  // What's being forwarded — count + a few role-labelled snippets for the panel.
  const preview = useConversationStore((s) => {
    const msgs = messageStateSelectors.forwardableSelectedMessages(s);
    return {
      count: msgs.length,
      lines: msgs.slice(0, 6).map((m) => ({
        role: m.role === 'user' ? t('messageForward.role.user') : t('messageForward.role.agent'),
        text: getForwardedMessageText(m).replaceAll(/\s+/g, ' ').slice(0, 60),
      })),
    };
  }, isEqual);

  useFetchAgentList();

  const handleForward = () => {
    if (targets.length === 0) return;
    forwardMessages(targets, note);
    close();
  };

  const avatarOf = (avatar: unknown) => (typeof avatar === 'string' ? avatar : undefined);

  return (
    <Flexbox horizontal className={stylex.props(styles.body).className} gap={16}>
      {/* Left: searchable multi-select agent list */}
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <SearchBar
          allowClear
          placeholder={t('messageForward.modal.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Flexbox className={stylex.props(styles.list).className} gap={4}>
          {candidates.length === 0 ? (
            <Flexbox align={'center'} justify={'center'} padding={24}>
              <Text type={'secondary'}>{t('messageForward.modal.empty')}</Text>
            </Flexbox>
          ) : (
            candidates.map((agent) => {
              const checked = selectedIds.includes(agent.id);
              return (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.row, checked && styles.rowSelected).className}
                  gap={8}
                  key={agent.id}
                  onClick={() => toggle(agent.id)}
                >
                  <SelectCircle checked={checked} />
                  <AgentAvatar
                    agentId={agent.id}
                    avatar={avatarOf(agent.avatar)}
                    background={agent.backgroundColor || undefined}
                    name={agent.label || t('untitledAgent')}
                    size={22}
                  />
                  <Text ellipsis style={{ flex: 1 }}>
                    {agent.label || t('untitledAgent')}
                  </Text>
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>

      <div {...stylex.props(styles.divider)} />

      {/* Right: forwarded content preview + note */}
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('messageForward.transcript.header', { count: preview.count })}
        </Text>
        <Flexbox className={stylex.props(styles.preview).className} flex={1}>
          <Flexbox className={stylex.props(styles.previewLines).className} flex={1} gap={4}>
            {preview.lines.map((line, i) => (
              <div {...stylex.props(styles.previewLine)} key={i}>
                <Text strong style={{ fontSize: 12 }}>
                  {line.role}:
                </Text>{' '}
                {line.text}
              </div>
            ))}
            {preview.count > preview.lines.length && (
              <div {...stylex.props(styles.previewMore)}>
                {t('messageForward.modal.moreMessages', {
                  count: preview.count - preview.lines.length,
                })}
              </div>
            )}
          </Flexbox>
          <div {...stylex.props(styles.noteDivider)} />
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            className={stylex.props(styles.note).className}
            placeholder={t('messageForward.modal.notePlaceholder')}
            resize={false}
            value={note}
            variant={'borderless'}
            onChange={(e) => setNote(e.target.value)}
          />
        </Flexbox>

        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button onClick={close}>{t('messageForward.bar.cancel')}</Button>
          <Button disabled={selectedIds.length === 0} type={'primary'} onClick={handleForward}>
            {selectedIds.length > 0
              ? t('messageForward.modal.sendCount', { count: selectedIds.length })
              : t('messageForward.bar.forward')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

ForwardModalContent.displayName = 'ForwardModalContent';

interface OpenForwardModalOptions {
  /**
   * The conversation store is context-scoped, and the modal renders in the
   * global `ModalHost` tree — hand the live store api back so selection state
   * and `exitSelectionMode` stay wired to the conversation that opened it.
   */
  createConversationStore: () => StoreApiWithSelector<ConversationStore>;
  onClosed?: () => void;
}

export const openForwardModal = ({ createConversationStore, onClosed }: OpenForwardModalOptions) =>
  createModal({
    content: (
      <Provider createStore={createConversationStore}>
        <ForwardModalContent />
      </Provider>
    ),
    footer: null,
    // NOT `onOpenChange`: that skips `instance.close()`, which is how the
    // in-content Cancel and Forward buttons close this modal.
    onOpenChangeComplete: (open) => {
      if (!open) onClosed?.();
    },
    title: translate('messageForward.modal.title', { ns: 'chat' }),
    width: 760,
  });
