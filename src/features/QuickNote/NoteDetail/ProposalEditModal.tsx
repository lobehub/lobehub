'use client';

import type { QuickNoteProposalKind, QuickNoteProposalPayload } from '@lobechat/types';
import {
  Button,
  createModal,
  cssVar,
  Flexbox,
  Input,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getQuickNoteProposalField,
  QUICK_NOTE_PROPOSAL_FIELDS,
  type QuickNoteProposalFieldKey,
  setQuickNoteProposalFields,
} from '@/services/quickNote';

interface ProposalEditContentProps {
  kind: QuickNoteProposalKind;
  /** Persist the edited payload; a rejection keeps the modal open with the draft. */
  onSave: (payload: QuickNoteProposalPayload) => Promise<unknown>;
  payload: QuickNoteProposalPayload;
}

const ProposalEditContent = ({ kind, onSave, payload }: ProposalEditContentProps) => {
  const { t } = useTranslation('note');
  const { close } = useModalContext();
  const fields = QUICK_NOTE_PROPOSAL_FIELDS[kind];
  const [draft, setDraft] = useState<Partial<Record<QuickNoteProposalFieldKey, string>>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.key, getQuickNoteProposalField(kind, payload, field.key)]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const valid = fields.every((field) => !field.required || draft[field.key]?.trim());

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(setQuickNoteProposalFields(kind, payload, draft));
      close();
    } catch {
      toast.error(t('agentic.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={12} padding={16}>
      {fields.map((field, index) => {
        const value = draft[field.key] ?? '';
        const onChange = (next: string) => setDraft((prev) => ({ ...prev, [field.key]: next }));

        return (
          <Flexbox gap={6} key={field.key}>
            <Text color={cssVar.colorTextSecondary} fontSize={12}>
              {t(`agentic.proposal.field.${field.key}` as never)}
            </Text>
            {field.multiline ? (
              <TextArea
                autoFocus={index === 0}
                autoSize={{ maxRows: 12, minRows: 4 }}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
            ) : (
              <Input
                autoFocus={index === 0}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onPressEnter={() => void save()}
              />
            )}
          </Flexbox>
        );
      })}
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={saving} onClick={close}>
          {t('agentic.proposal.cancelEdit')}
        </Button>
        <Button disabled={!valid} loading={saving} type={'primary'} onClick={() => void save()}>
          {t('agentic.proposal.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Opens a modal that edits the main text fields of one Proposal's payload. */
export const openProposalEditModal = (props: ProposalEditContentProps) =>
  createModal({
    content: <ProposalEditContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: t('agentic.proposal.editTitle', { ns: 'note' }),
    width: 'min(560px, 92vw)',
  });
