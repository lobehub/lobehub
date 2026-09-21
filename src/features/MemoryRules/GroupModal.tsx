'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, createModal, Input, Text, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService, type RuleGroup } from '@/services/expertise';

interface GroupContentProps {
  /** Present when renaming; absent when opening a new group. */
  group?: RuleGroup;
  onDone: () => void;
}

/**
 * A group is a name and a gate question. The question is what the distillation asks before it
 * files a rule here, so it is asked of the reviewer too, right where they name the group.
 */
const GroupContent = ({ group, onDone }: GroupContentProps) => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const [title, setTitle] = useState(group?.domain.title ?? '');
  const [gate, setGate] = useState(group?.domain.domainFilter ?? '');
  const [busy, setBusy] = useState(false);
  const ready = Boolean(title.trim() && gate.trim());

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await (group
        ? expertiseService.updateRuleGroup(group.domain.id, {
            gate: gate.trim(),
            title: title.trim(),
          })
        : expertiseService.createRuleGroup({ gate: gate.trim(), title: title.trim() }));
      onDone();
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={16} padding={'8px 0 0'}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('rules.group.nameLabel')}
        </Text>
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Flexbox>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('rules.group.gateLabel')}
        </Text>
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('rules.group.gatePlaceholder')}
          value={gate}
          onChange={(e) => setGate(e.target.value)}
        />
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button size={'small'} onClick={() => close()}>
          {t('rules.field.cancel')}
        </Button>
        <Button
          disabled={!ready}
          loading={busy}
          size={'small'}
          type={'primary'}
          onClick={() => void submit()}
        >
          {t(group ? 'rules.group.submitRename' : 'rules.group.submitCreate')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export const createGroupModal = (props: GroupContentProps) =>
  createModal({
    content: <GroupContent {...props} />,
    footer: null,
    maskClosable: true,
    title: translate(props.group ? 'rules.group.renameTitle' : 'rules.group.newTitle', {
      ns: 'memory',
    }),
    width: 480,
  });
