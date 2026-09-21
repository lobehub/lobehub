'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    margin: 0;
    font-size: 13.5px;
    line-height: 1.75;
    white-space: pre-wrap;
  `,
  edit: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  head: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    margin-block: 22px 6px;

    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.02em;
  `,
  muted: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface FieldProps {
  editable?: boolean;
  label: string;
  /** Rendered dimmed: a placeholder, or a value that is really the absence of one. */
  muted?: boolean;
  onSave?: (value: string) => void;
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
      <div className={styles.head}>
        <span>{label}</span>
        {editable && !editing && (
          <span
            className={styles.edit}
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
              onClick={() => {
                onSave?.(draft.trim());
                setEditing(false);
              }}
            >
              {t('rules.field.save')}
            </Button>
          </Flexbox>
        </Flexbox>
      ) : (
        <p
          className={styles.body}
          style={muted || !value ? { color: cssVar.colorTextTertiary } : undefined}
        >
          {value || placeholder}
        </p>
      )}
    </div>
  );
};

export default Field;
