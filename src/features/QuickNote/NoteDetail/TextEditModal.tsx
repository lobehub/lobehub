'use client';

import { Button, createModal, Flexbox, TextArea, toast, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface QuickNoteTextEditModalProps {
  initialValue: string;
  /** Persist the edited text; a rejection keeps the modal open with the draft. */
  onSave: (value: string) => Promise<unknown>;
  /** Visible TextArea height bounds. */
  rows?: { maxRows: number; minRows: number };
}

const TextEditContent = memo<QuickNoteTextEditModalProps>(
  ({ initialValue, onSave, rows = { maxRows: 8, minRows: 3 } }) => {
    const { t } = useTranslation('note');
    const { close } = useModalContext();
    const [draft, setDraft] = useState(initialValue);
    const [saving, setSaving] = useState(false);

    const save = async () => {
      if (!draft.trim() || saving) return;
      setSaving(true);
      try {
        await onSave(draft);
        close();
      } catch {
        toast.error(t('agentic.actionFailed'));
      } finally {
        setSaving(false);
      }
    };

    return (
      <Flexbox gap={12} padding={16}>
        <TextArea
          autoFocus
          autoSize={rows}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button disabled={saving} onClick={close}>
            {t('agentic.proposal.cancelEdit')}
          </Button>
          <Button
            disabled={!draft.trim()}
            loading={saving}
            type={'primary'}
            onClick={() => void save()}
          >
            {t('agentic.proposal.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

TextEditContent.displayName = 'QuickNoteTextEditContent';

/** Opens a modal that edits one piece of Quick Note text, such as a Comment. */
export const openQuickNoteTextEditModal = ({
  title,
  ...props
}: QuickNoteTextEditModalProps & { title: string }) =>
  createModal({
    content: <TextEditContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title,
    width: 'min(560px, 92vw)',
  });

/** Modal titles resolved outside React. */
export const quickNoteTextEditTitles = {
  comment: () => t('agentic.comment.edit', { ns: 'note' }),
};
