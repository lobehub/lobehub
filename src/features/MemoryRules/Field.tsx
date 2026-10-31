'use client';

import { Button, Flexbox, Icon, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  body: { margin: '0', fontSize: '13.5px', lineHeight: 1.75, whiteSpace: 'pre-wrap' },
  edit: {
    cursor: 'pointer',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBlockStart: '22px',
    marginBlockEnd: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextTertiary,
    letterSpacing: '0.02em',
  },
});

interface FieldProps {
  editable?: boolean;
  label: string;
  /** Rendered dimmed: a placeholder, or a value that is really the absence of one. */
  muted?: boolean;
  /** Resolves to whether the save landed; the editor stays open with the draft when it did not. */
  onSave?: (value: string) => Promise<boolean>;
  placeholder?: string;
  value?: string;
}

/**
 * One heading of the rule document. Each maps to a column or a section of the lesson row, so
 * editing one never rewrites the others; the structure the distillation produced stays intact.
 */
const Field = ({ editable, label, muted, onSave, placeholder, value }: FieldProps) => {
  const { t } = useTranslation('memory');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div>
      <div {...stylex.props(styles.head)}>
        <span>{label}</span>
        {editable && !editing && (
          <span
            {...stylex.props(styles.edit)}
            onClick={() => {
              setDraft(value ?? '');
              setEditing(true);
            }}
          >
            <Icon icon={PencilIcon} size={12} />
            {t('rules.field.edit')}
          </span>
        )}
      </div>
      {editing ? (
        <Flexbox gap={8}>
          <TextArea
            autoFocus
            autoSize={{ maxRows: 20, minRows: 3 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Flexbox horizontal gap={6} justify={'flex-end'}>
            <Button size={'small'} onClick={() => setEditing(false)}>
              {t('rules.field.cancel')}
            </Button>
            <Button
              size={'small'}
              type={'primary'}
              onClick={async () => {
                if (!onSave) return setEditing(false);
                if (await onSave(draft.trim())) setEditing(false);
              }}
            >
              {t('rules.field.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      ) : (
        <p
          className={stylex.props(styles.body).className}
          style={muted || !value ? { color: cssVar.colorTextTertiary } : undefined}
        >
          {value || placeholder}
        </p>
      )}
    </div>
  );
};

export default Field;
