import { ActionIcon, Button, TextArea, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon } from 'lucide-react';
import { memo, useState } from 'react';

import { useEntityDataContext } from '../context';
import { resolveDraft, useDraftStore } from '../drafts';
import { useEntityFormat } from '../format';
import { type MemoryEntity } from '../types';
import Section from './Section';

const styles = stylex.create({
  text: {
    color: cssVar.colorText,
    fontSize: '17px',
    lineHeight: '28px',
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  placeholder: { color: cssVar.colorTextTertiary, fontSize: '14px' },
  foot: {
    alignItems: 'center',
    color: cssVar.colorTextTertiary,
    display: 'flex',
    fontSize: '12px',
    gap: '4px',
    marginBlockStart: '-4px',
  },
  editActions: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
});

interface NowSectionProps {
  entity: MemoryEntity;
}

/**
 * The one sentence that is overwritten as things change. Older wording is not lost: it is what
 * the timeline below records.
 */
const NowSection = memo<NowSectionProps>(({ entity }) => {
  const format = useEntityFormat();
  const { t } = format;
  const { updateNow } = useEntityDataContext();
  const draft = useDraftStore((s) => s.drafts[entity.id]);
  const setStoredDraft = useDraftStore((s) => s.setDraft);
  const setDraft = (text?: string) => setStoredDraft(entity.id, text);
  const [saving, setSaving] = useState(false);
  const editing = draft !== undefined;

  const save = async () => {
    const { save: changed, value: next } = resolveDraft(draft, entity.description);
    if (!changed) return setDraft(undefined);
    setSaving(true);
    try {
      await updateNow(entity.id, next);
      setDraft(undefined);
    } catch {
      // Keep the draft so nothing typed is lost.
      toast.error({ title: t('entity.now.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title={t('entity.now.title')}>
      {editing ? (
        <>
          <TextArea
            autoFocus
            autoSize={{ maxRows: 8, minRows: 2 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDraft(undefined);
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
          />
          <div {...stylex.props(styles.editActions)}>
            <Button size={'small'} onClick={() => setDraft(undefined)}>
              {t('entity.now.cancel')}
            </Button>
            <Button loading={saving} size={'small'} type={'primary'} onClick={save}>
              {t('entity.now.save')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p {...stylex.props(styles.text, !entity.description && styles.placeholder)}>
            {entity.description || t('entity.now.empty')}
          </p>
          <div {...stylex.props(styles.foot)}>
            <span>{t('entity.now.updated', { ago: format.ago(entity.updatedAt) })}</span>
            <ActionIcon
              aria-label={t('entity.now.edit')}
              icon={PencilIcon}
              size={'small'}
              title={t('entity.now.edit')}
              onClick={() => setDraft(entity.description)}
            />
          </div>
        </>
      )}
    </Section>
  );
});

NowSection.displayName = 'NowSection';

export default NowSection;
