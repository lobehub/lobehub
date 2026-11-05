'use client';

import { ActionIcon, Block, Button, confirmModal, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon, PlusIcon, XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openCriterionEditModal } from '@/features/Acceptance';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { goalService } from '@/services/goal';
import type { GoalCriterionWithInstruction } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

const styles = stylex.create({
  row: {
    paddingBlock: '8px',
    borderBlockEndWidth: { 'default': null, ':not(:last-child)': '1px' },
    borderBlockEndStyle: { 'default': null, ':not(:last-child)': 'dashed' },
    borderBlockEndColor: { 'default': null, ':not(:last-child)': cssVar.colorBorderSecondary },
  },
  seq: {
    flex: 'none',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextQuaternary,
  },
});

/**
 * The goal's structured acceptance standard: the persisted verify criteria the
 * terminal Goal-acceptance Task is gated on. Rendered as its own section so the
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

    const rebind = useCallback(
      async (nextIds: string[]) => {
        await goalService.setAcceptanceCriteria(goalId, nextIds);
        await refreshGoalGraph(goalId);
        await mutate();
      },
      [goalId, mutate, refreshGoalGraph],
    );

    const openEdit = (item?: GoalCriterionWithInstruction) => {
      openCriterionEditModal({
        criterion: item
          ? {
              description: item.description ?? undefined,
              instruction: item.instruction,
              onFail: item.onFail,
              required: item.required,
              title: item.title,
              verifierConfig: item.verifierConfig ?? undefined,
              verifierType: item.verifierType,
            }
          : { onFail: 'manual', required: true, title: '', verifierType: 'agent' },
        isNew: !item,
        onSubmit: async (draft) => {
          if (item && (draft.instruction ?? '').trim() === (item.instruction ?? '').trim()) {
            await verifyService.updateCriterion(item.id, {
              description: draft.description || null,
              onFail: draft.onFail,
              required: draft.required,
              title: draft.title,
              verifierConfig: draft.verifierConfig,
              verifierType: draft.verifierType,
            });
            await mutate();
          } else {
            const [createdId] = await verifyService.createCriteria([draft]);
            if (createdId) {
              await rebind(
                item
                  ? criteriaIds.map((id) => (id === item.id ? createdId : id))
                  : [...criteriaIds, createdId],
              );
            }
          }
        },
      });
    };

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

    // The section header (title + count + gate hint) belongs to the hosting
    // accordion row in ProcessControl — this renders the list body only.
    return (
      <Block paddingBlock={4} paddingInline={16} variant={'outlined'}>
        {criteriaIds.length === 0 && (
          <Flexbox className={stylex.props(styles.row).className}>
            <Text fontSize={13} type={'secondary'}>
              {t('goalAcceptance.empty')}
            </Text>
          </Flexbox>
        )}
        {(criteria ?? []).map((item, index) => (
          <Flexbox className={stylex.props(styles.row).className} gap={4} key={item.id}>
            <Flexbox horizontal align={'center'} gap={10}>
              <span {...stylex.props(styles.seq)}>C{index + 1}</span>
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
          </Flexbox>
        ))}
        {canEdit && (
          <Flexbox horizontal className={stylex.props(styles.row).className}>
            <Button
              icon={<Icon icon={PlusIcon} />}
              size={'small'}
              type={'text'}
              onClick={() => openEdit()}
            >
              {t('goalAcceptance.add')}
            </Button>
          </Flexbox>
        )}
      </Block>
    );
  },
);

GoalAcceptanceCriteria.displayName = 'GoalAcceptanceCriteria';

export default GoalAcceptanceCriteria;
