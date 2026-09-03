'use client';

import { Block, Flexbox, Icon, Input, TextArea } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { PencilIcon, PlusIcon, XIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { goalService } from '@/services/goal';
import type { GoalCriterionWithInstruction } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    padding-block: 8px;

    &:not(:last-child) {
      border-block-end: 1px dashed ${cssVar.colorBorderSecondary};
    }
  `,
  seq: css`
    flex: none;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface CriterionFormValue {
  description: string;
  instruction: string;
  title: string;
}

const emptyForm: CriterionFormValue = { description: '', instruction: '', title: '' };

/**
 * The goal's structured acceptance standard: the persisted verify criteria the
 * terminal Goal-acceptance Work is gated on. Rendered as its own section so the
 * standard is inspectable and editable instead of living only inside the
 * requirement prose.
 *
 * Editing note: the how-to-judge instruction lives in a linked document, so a
 * save that changes it persists a replacement criterion (new row + doc) and
 * rebinds the goal; title/description-only edits update the row in place.
 */
const GoalAcceptanceCriteria = memo<{ criteriaIds: string[]; goalId: string }>(
  ({ criteriaIds, goalId }) => {
    const { t } = useTranslation('chat');
    const { allowed: canEdit } = usePermission('create_content');
    const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);

    const { data: criteria, mutate } = useClientDataSWR(
      criteriaIds.length > 0 ? ['goal-acceptance-criteria', goalId, criteriaIds.join(',')] : null,
      () => verifyService.getCriteria(criteriaIds),
    );

    const [editingId, setEditingId] = useState<string | 'new' | null>(null);
    const [form, setForm] = useState<CriterionFormValue>(emptyForm);
    // The judge instruction the editor opened with — an unchanged instruction
    // means the row can update in place; a changed one persists a replacement
    // criterion (the rule body lives in an immutable linked document).
    const [initialInstruction, setInitialInstruction] = useState('');
    const [saving, setSaving] = useState(false);

    const openEdit = (item: GoalCriterionWithInstruction) => {
      const instruction = item.instruction ?? '';
      setForm({ description: item.description ?? '', instruction, title: item.title });
      setInitialInstruction(instruction);
      setEditingId(item.id);
    };

    const rebind = useCallback(
      async (nextIds: string[]) => {
        await goalService.setAcceptanceCriteria(goalId, nextIds);
        await refreshGoalGraph(goalId);
        await mutate();
      },
      [goalId, mutate, refreshGoalGraph],
    );

    const handleSave = useCallback(async () => {
      const title = form.title.trim();
      if (!title || saving) return;
      setSaving(true);
      try {
        const instruction = form.instruction.trim();
        if (editingId !== 'new' && editingId && instruction === initialInstruction.trim()) {
          await verifyService.updateCriterion(editingId, {
            description: form.description.trim() || null,
            title,
          });
          await mutate();
        } else {
          const [createdId] = await verifyService.createCriteria([
            {
              description: form.description.trim() || undefined,
              instruction: instruction || undefined,
              onFail: 'manual',
              required: true,
              title,
              verifierType: 'agent',
            },
          ]);
          if (createdId) {
            await rebind(
              editingId === 'new'
                ? [...criteriaIds, createdId]
                : criteriaIds.map((id) => (id === editingId ? createdId : id)),
            );
          }
        }
        setEditingId(null);
        setForm(emptyForm);
      } finally {
        setSaving(false);
      }
    }, [criteriaIds, editingId, form, initialInstruction, mutate, rebind, saving]);

    const handleRemove = (item: GoalCriterionWithInstruction) => {
      confirmModal({
        content: t('goalAcceptance.removeConfirm.content', { title: item.title }),
        okButtonProps: { danger: true },
        onOk: async () => {
          await rebind(criteriaIds.filter((id) => id !== item.id));
        },
        title: t('goalAcceptance.removeConfirm.title'),
      });
    };

    const editorForm = (
      <Flexbox gap={8} paddingBlock={8}>
        <Input
          placeholder={t('goalAcceptance.form.titlePlaceholder')}
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
        />
        <TextArea
          autoSize={{ maxRows: 4, minRows: 1 }}
          placeholder={t('goalAcceptance.form.descriptionPlaceholder')}
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
        />
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('goalAcceptance.form.instructionPlaceholder')}
          value={form.instruction}
          onChange={(event) => setForm((prev) => ({ ...prev, instruction: event.target.value }))}
        />
        <Flexbox horizontal gap={8}>
          <Button
            disabled={!form.title.trim()}
            loading={saving}
            size={'small'}
            type={'primary'}
            onClick={handleSave}
          >
            {t('save', { ns: 'common' })}
          </Button>
          <Button
            size={'small'}
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
            }}
          >
            {t('cancel', { ns: 'common' })}
          </Button>
        </Flexbox>
      </Flexbox>
    );

    // The section header (title + count + gate hint) belongs to the hosting
    // accordion row in ProcessControl — this renders the list body only.
    return (
      <Block paddingBlock={4} paddingInline={16} variant={'outlined'}>
        {criteriaIds.length === 0 && editingId !== 'new' && (
          <Flexbox className={styles.row}>
            <Text fontSize={13} type={'secondary'}>
              {t('goalAcceptance.empty')}
            </Text>
          </Flexbox>
        )}
        {(criteria ?? []).map((item, index) => (
          <Flexbox className={styles.row} gap={4} key={item.id}>
            {editingId === item.id ? (
              editorForm
            ) : (
              <>
                <Flexbox horizontal align={'center'} gap={10}>
                  <span className={styles.seq}>C{index + 1}</span>
                  <Text style={{ flex: 1, minWidth: 0 }} weight={500}>
                    {item.title}
                  </Text>
                  {canEdit && (
                    <Flexbox horizontal gap={2} style={{ flex: 'none' }}>
                      <ActionIcon
                        icon={PencilIcon}
                        size={'small'}
                        title={t('goalAcceptance.edit')}
                        onClick={() => openEdit(item)}
                      />
                      <ActionIcon
                        icon={XIcon}
                        size={'small'}
                        title={t('goalAcceptance.remove')}
                        onClick={() => handleRemove(item)}
                      />
                    </Flexbox>
                  )}
                </Flexbox>
                {item.description && (
                  <Text fontSize={13} style={{ paddingInlineStart: 30 }} type={'secondary'}>
                    {item.description}
                  </Text>
                )}
                {item.instruction && (
                  <Text
                    fontSize={12}
                    style={{ color: cssVar.colorTextTertiary, paddingInlineStart: 30 }}
                  >
                    {t('goalAcceptance.judgePrefix')}
                    {item.instruction}
                  </Text>
                )}
              </>
            )}
          </Flexbox>
        ))}
        {editingId === 'new' ? (
          <Flexbox className={styles.row}>{editorForm}</Flexbox>
        ) : (
          canEdit && (
            <Flexbox horizontal className={styles.row}>
              <Button
                icon={<Icon icon={PlusIcon} />}
                size={'small'}
                type={'text'}
                onClick={() => {
                  setForm(emptyForm);
                  setEditingId('new');
                }}
              >
                {t('goalAcceptance.add')}
              </Button>
            </Flexbox>
          )
        )}
      </Block>
    );
  },
);

GoalAcceptanceCriteria.displayName = 'GoalAcceptanceCriteria';

export default GoalAcceptanceCriteria;
