'use client';

import { Flexbox, SearchBar, Text, TextArea } from '@lobehub/ui';
import { Button, Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
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
  list: css`
    overflow-y: auto;
    max-block-size: 280px;
    margin-inline: -4px;
    padding-inline: 4px;
  `,
  row: css`
    cursor: pointer;

    min-block-size: 44px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

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

/**
 * Dialog on the Forward button: search + multi-select agents, attach an optional
 * note, and submit. `destroyOnHidden` resets the picker between opens.
 */
const ForwardModal = memo<ForwardModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('chat');
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const currentAgentId = useConversationStore(contextSelectors.agentId);
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const forwardMessages = useForwardMessages();

  useFetchAgentList();

  const candidates = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    return agents
      .filter((agent) => agent.type === 'agent' && agent.id !== currentAgentId)
      .filter((agent) => !trimmed || (agent.title || '').toLowerCase().includes(trimmed));
  }, [agents, currentAgentId, keyword]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const avatarOf = (avatar: unknown) => (typeof avatar === 'string' ? avatar : undefined);

  const handleForward = () => {
    const targets: ForwardTarget[] = selectedIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ id: a.id, title: a.title }));
    if (targets.length === 0) return;
    forwardMessages(targets, note);
    onClose();
  };

  return (
    <Modal
      destroyOnHidden
      footer={null}
      open={open}
      title={t('messageForward.modal.title')}
      width={480}
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        <SearchBar
          allowClear
          placeholder={t('messageForward.modal.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Flexbox className={styles.list} gap={2}>
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
        <TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          placeholder={t('messageForward.modal.notePlaceholder')}
          resize={false}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button block disabled={selectedIds.length === 0} type={'primary'} onClick={handleForward}>
          {selectedIds.length > 0
            ? t('messageForward.modal.sendCount', { count: selectedIds.length })
            : t('messageForward.bar.forward')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

ForwardModal.displayName = 'ForwardModal';

export default ForwardModal;
