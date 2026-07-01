'use client';

import { Flexbox, SearchBar, Text, TextArea } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import AgentAvatar from '@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { contextSelectors, useConversationStore } from '../store';
import SelectCircle from './SelectCircle';
import { type ForwardTarget, useForwardMessages } from './useForwardMessages';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    block-size: 460px;
  `,
  divider: css`
    align-self: stretch;
    inline-size: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  list: css`
    overflow-y: auto;
    flex: 1;
    margin-inline: -4px;
    padding-inline: 4px;
  `,
  // Shared container holding the message preview and the note input, split by a
  // divider above the input.
  preview: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  previewLines: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 12px;
    padding-inline: 12px;
  `,
  note: css`
    background: transparent;
  `,
  noteDivider: css`
    block-size: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  previewLine: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  previewMore: css`
    padding-block-start: 2px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    cursor: pointer;

    min-block-size: 44px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusLG};

    transition: background-color 0.1s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  rowSelected: css`
    background-color: ${cssVar.colorFillQuaternary};
  `,
}));

interface ForwardModalProps {
  onClose: () => void;
  open: boolean;
}

const ForwardModal = memo<ForwardModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('chat');
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const currentAgentId = useConversationStore(contextSelectors.agentId);
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const forwardMessages = useForwardMessages();

  // What's being forwarded — count + a few role-labelled snippets for the panel.
  const preview = useConversationStore((s) => {
    const selected = new Set(s.selectedMessageIds);
    const msgs = s.displayMessages.filter((m) => selected.has(m.id));
    return {
      count: msgs.length,
      lines: msgs.slice(0, 6).map((m) => ({
        role: m.role === 'user' ? t('messageForward.role.user') : t('messageForward.role.agent'),
        text: (m.content ?? '').replaceAll(/\s+/g, ' ').slice(0, 60),
      })),
    };
  }, isEqual);

  useFetchAgentList();

  const candidates = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    return agents
      .filter((agent) => agent.type === 'agent' && agent.id !== currentAgentId)
      .filter((agent) => !trimmed || (agent.title || '').toLowerCase().includes(trimmed));
  }, [agents, currentAgentId, keyword]);

  const selectedAgents = useMemo(
    () =>
      selectedIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a),
    [selectedIds, agents],
  );

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleClose = () => {
    setSelectedIds([]);
    setKeyword('');
    setNote('');
    onClose();
  };

  const handleForward = () => {
    const targets: ForwardTarget[] = selectedAgents.map((a) => ({ id: a.id, title: a.title }));
    if (targets.length === 0) return;
    forwardMessages(targets, note);
    handleClose();
  };

  const avatarOf = (avatar: unknown) => (typeof avatar === 'string' ? avatar : undefined);

  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={open}
      title={t('messageForward.modal.title')}
      width={760}
      onCancel={handleClose}
    >
      <Flexbox horizontal className={styles.body} gap={16}>
        {/* Left: searchable multi-select agent list */}
        <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
          <SearchBar
            allowClear
            placeholder={t('messageForward.modal.searchPlaceholder')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Flexbox className={styles.list} gap={4}>
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
                    className={cx(styles.row, checked && styles.rowSelected)}
                    gap={8}
                    key={agent.id}
                    onClick={() => toggle(agent.id)}
                  >
                    <SelectCircle checked={checked} />
                    <AgentAvatar avatar={avatarOf(agent.avatar)} />
                    <Text ellipsis style={{ flex: 1 }}>
                      {agent.title || t('untitledAgent')}
                    </Text>
                  </Flexbox>
                );
              })
            )}
          </Flexbox>
        </Flexbox>

        <div className={styles.divider} />

        {/* Right: forwarded content preview + note */}
        <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('messageForward.transcript.header', { count: preview.count })}
          </Text>
          <Flexbox className={styles.preview} flex={1}>
            <Flexbox className={styles.previewLines} flex={1} gap={4}>
              {preview.lines.map((line, i) => (
                <div className={styles.previewLine} key={i}>
                  <Text strong style={{ fontSize: 12 }}>
                    {line.role}:
                  </Text>{' '}
                  {line.text}
                </div>
              ))}
              {preview.count > preview.lines.length && (
                <div className={styles.previewMore}>
                  {t('messageForward.modal.moreMessages', {
                    count: preview.count - preview.lines.length,
                  })}
                </div>
              )}
            </Flexbox>
            <div className={styles.noteDivider} />
            <TextArea
              autoSize={{ maxRows: 4, minRows: 2 }}
              className={styles.note}
              placeholder={t('messageForward.modal.notePlaceholder')}
              resize={false}
              value={note}
              variant={'borderless'}
              onChange={(e) => setNote(e.target.value)}
            />
          </Flexbox>

          <Flexbox horizontal gap={8} justify={'flex-end'}>
            <Button onClick={handleClose}>{t('messageForward.bar.cancel')}</Button>
            <Button disabled={selectedIds.length === 0} type={'primary'} onClick={handleForward}>
              {selectedIds.length > 0
                ? t('messageForward.modal.sendCount', { count: selectedIds.length })
                : t('messageForward.bar.forward')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Modal>
  );
});

ForwardModal.displayName = 'ForwardModal';

export default ForwardModal;
