'use client';

import type {
  AcceptanceFrame,
  AcceptanceFrameCriteria,
  AcceptanceFrameOperation,
} from '@lobechat/types';
import { Button, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { effectiveCriteria, parseCriteriaLines } from './frameBoard';

const SECTIONS = ['states', 'edgeCases', 'copy'] as const;

const styles = stylex.create({
  section: {
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    paddingBlockStart: 10,
  },
  heading: {
    fontSize: 12,
    fontWeight: 600,
  },
  list: {
    color: cssVar.colorText,
    fontSize: 13,
    lineHeight: 1.6,
    margin: 0,
    paddingInlineStart: 18,
  },
  empty: {
    color: cssVar.colorTextQuaternary,
    fontSize: 12,
  },
});

interface FrameCriteriaProps {
  canEdit: boolean;
  frame: AcceptanceFrame;
  onUpdate: (operation: AcceptanceFrameOperation) => Promise<boolean>;
}

/**
 * The node's acceptance points — states, edge cases, copy — written while the
 * review is still open and frozen with the baseline. They are what the real
 * capture is judged against later, so an empty section blocks the lock.
 */
const FrameCriteria = ({ canEdit, frame, onUpdate }: FrameCriteriaProps) => {
  const { t } = useTranslation('verify');
  const locked = Boolean(frame.baseline);
  const criteria = effectiveCriteria(frame);
  const [draft, setDraft] = useState<Record<keyof AcceptanceFrameCriteria, string>>();
  const [saving, setSaving] = useState(false);

  const startEditing = () =>
    setDraft({
      copy: frame.criteria.copy.join('\n'),
      edgeCases: frame.criteria.edgeCases.join('\n'),
      states: frame.criteria.states.join('\n'),
    });

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const ok = await onUpdate({
      criteria: {
        copy: parseCriteriaLines(draft.copy),
        edgeCases: parseCriteriaLines(draft.edgeCases),
        states: parseCriteriaLines(draft.states),
      },
      type: 'setCriteria',
    });
    setSaving(false);
    if (ok) setDraft(undefined);
  };

  return (
    <Flexbox gap={10}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text strong>{t('frames.criteria.title')}</Text>
        {locked ? (
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon color={cssVar.colorWarning} icon={Lock} size={12} />
            <Text fontSize={12} type={'secondary'}>
              {t('frames.criteria.frozen')}
            </Text>
          </Flexbox>
        ) : (
          canEdit &&
          !draft && (
            <Button size={'small'} onClick={startEditing}>
              {t('frames.criteria.edit')}
            </Button>
          )
        )}
      </Flexbox>
      {SECTIONS.map((section) => (
        <Flexbox gap={6} key={section} {...stylex.props(styles.section)}>
          <span {...stylex.props(styles.heading)}>{t(`frames.criteria.${section}`)}</span>
          {draft ? (
            <TextArea
              autoSize={{ maxRows: 12, minRows: 2 }}
              placeholder={t('frames.criteria.placeholder')}
              value={draft[section]}
              onChange={(event) => setDraft({ ...draft, [section]: event.target.value })}
            />
          ) : criteria[section].length > 0 ? (
            <ul {...stylex.props(styles.list)}>
              {criteria[section].map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          ) : (
            <span {...stylex.props(styles.empty)}>{t('frames.criteria.empty')}</span>
          )}
        </Flexbox>
      ))}
      {draft && (
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button size={'small'} type={'text'} onClick={() => setDraft(undefined)}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button loading={saving} size={'small'} type={'primary'} onClick={() => void save()}>
            {t('frames.criteria.save')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default FrameCriteria;
