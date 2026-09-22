'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { ActionIcon, Input, Select, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  /**
   * The value at rest looks like a field, not like prose: a bordered box the
   * same height the input will have, so entering edit mode changes what is in
   * the box and not where everything below it sits.
   */
  display: css`
    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  multiline: css`
    align-items: flex-start;
  `,
  value: css`
    flex: 1;

    min-width: 0;

    font-size: 13px;
    line-height: 22px;
    word-break: break-word;
    white-space: pre-wrap;
  `,
  placeholder: css`
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface InlineFieldProps {
  desc?: ReactNode;
  label: ReactNode;
  /** Multi-line values — commands and path lists — edit in a text area. */
  multiline?: boolean;
  /** Told when the field opens or closes, so a caller can fetch options only while it is open. */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Write the confirmed value. Rejecting keeps the field open with the
   * person's text still in it, and the reason goes to a toast.
   */
  onSave: (value: string) => Promise<void>;
  /** Shown in place of an empty value, muted. */
  placeholder: string;
  /** Refuse an empty value instead of saving it — for the one field that has no sensible blank. */
  required?: boolean;
  /**
   * Pick from a list instead of typing. Choosing is the confirmation: the
   * field saves on selection, so ✓ is not shown. The current value is always
   * selectable, even when the list does not carry it.
   */
  select?: { loading?: boolean; options: string[] };
  value: string;
}

/**
 * One setting that saves on its own.
 *
 * The panel used to hold every field as one draft behind one save button at
 * the very bottom, which is where nobody looked: changes were typed, the tab
 * was switched, and they were gone. Railway's settings page is the reference —
 * every value sits in its own box with a pencil, and confirming the edit is
 * the save. There is nothing to remember to do afterwards.
 */
const InlineField = memo<InlineFieldProps>(
  ({ desc, label, multiline, onEditingChange, onSave, placeholder, required, select, value }) => {
    const { t } = useTranslation('common');
    const [draft, setDraft] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const editing = draft !== null;

    const open = () => {
      setDraft(value);
      onEditingChange?.(true);
    };
    const cancel = () => {
      setDraft(null);
      onEditingChange?.(false);
    };
    const commit = async (raw: string) => {
      const next = raw.trim();
      if (required && !next) return;
      if (next === value) {
        cancel();
        return;
      }
      setSaving(true);
      try {
        await onSave(next);
        cancel();
      } catch (error) {
        toast.error((error as { message?: string })?.message || String(error));
      } finally {
        setSaving(false);
      }
    };
    const save = () => (draft === null ? Promise.resolve() : commit(draft));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
      // Enter confirms a single-line value; in a text area it is a newline,
      // and ⌘/Ctrl+Enter confirms instead.
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void save();
      }
    };

    return (
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'} weight={500}>
          {label}
        </Text>
        {desc && (
          <Text fontSize={12} type={'secondary'}>
            {desc}
          </Text>
        )}
        {editing && select ? (
          <Flexbox horizontal align={'center'} gap={8}>
            <Select
              autoFocus
              defaultOpen
              showSearch
              disabled={saving}
              loading={select.loading || saving}
              placeholder={placeholder}
              style={{ flex: 1 }}
              value={draft || null}
              options={(draft && !select.options.includes(draft)
                ? [draft, ...select.options]
                : select.options
              ).map((name) => ({ label: name, value: name }))}
              onChange={(next) => {
                if (typeof next === 'string' && next) void commit(next);
              }}
            />
            <ActionIcon
              disabled={saving}
              icon={XIcon}
              size={'small'}
              title={t('cancel')}
              onClick={cancel}
            />
          </Flexbox>
        ) : editing ? (
          <Flexbox horizontal align={multiline ? 'flex-start' : 'center'} gap={8}>
            {multiline ? (
              <TextArea
                autoFocus
                autoSize={{ maxRows: 10, minRows: 2 }}
                placeholder={placeholder}
                style={{ flex: 1 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
            ) : (
              <Input
                autoFocus
                placeholder={placeholder}
                style={{ flex: 1 }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
            <ActionIcon
              disabled={required && !draft.trim()}
              icon={CheckIcon}
              loading={saving}
              size={'small'}
              title={t('save')}
              onClick={save}
            />
            <ActionIcon
              disabled={saving}
              icon={XIcon}
              size={'small'}
              title={t('cancel')}
              onClick={cancel}
            />
          </Flexbox>
        ) : (
          <div className={cx(styles.display, multiline && styles.multiline)}>
            <span className={cx(styles.value, !value && styles.placeholder)}>
              {value || placeholder}
            </span>
            <ActionIcon icon={PencilIcon} size={'small'} title={t('edit')} onClick={open} />
          </div>
        )}
      </Flexbox>
    );
  },
);

InlineField.displayName = 'InlineField';

export default InlineField;
