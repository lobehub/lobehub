'use client';

import type { GoalMetricComparison, GoalMetricCriterion } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  Button,
  createModal,
  Input,
  type ModalInstance,
  Select,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGoalStore } from '@/store/goal';

/**
 * Declare one measured acceptance clause: "this series must reach this
 * number". The key doubles as the series name the probe / manual observations
 * write to, so declaring is enough — the first observation creates the series.
 * Given an existing clause it edits that clause in place: the declare merges
 * by key, so the key stays locked and only the name, condition and target move.
 */
const DeclareMetricContent = memo<{ goalId: string; initial?: GoalMetricCriterion }>(
  ({ goalId, initial }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const declareGoalMetric = useGoalStore((s) => s.declareGoalMetric);

    const [key, setKey] = useState(initial?.key ?? '');
    const [title, setTitle] = useState(initial?.title ?? '');
    const [op, setOp] = useState<GoalMetricComparison>(initial?.op ?? 'gte');
    const [target, setTarget] = useState(initial ? String(initial.target) : '');
    const [busy, setBusy] = useState(false);

    const submit = async () => {
      const trimmedKey = key.trim();
      const parsedTarget = Number(target);
      if (!trimmedKey || !Number.isFinite(parsedTarget) || busy) return;
      setBusy(true);
      try {
        await declareGoalMetric(goalId, {
          key: trimmedKey,
          op,
          target: parsedTarget,
          title: title.trim() || undefined,
        });
        close();
      } catch (error) {
        // Keep the form open — a silent close would be indistinguishable from success.
        console.error('[NorthStar] failed to declare metric:', error);
        toast.error(t('goalProcess.northStar.declare.failed'));
      } finally {
        setBusy(false);
      }
    };

    return (
      <Flexbox gap={16} paddingBlock={'4px 8px'}>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('goalProcess.northStar.declare.keyLabel')}
          </Text>
          <Input
            autoFocus={!initial}
            disabled={!!initial}
            placeholder={t('goalProcess.northStar.declare.keyPlaceholder')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('goalProcess.northStar.declare.titleLabel')}
          </Text>
          <Input
            placeholder={t('goalProcess.northStar.declare.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Flexbox>
        <Flexbox horizontal gap={12}>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13} weight={500}>
              {t('goalProcess.northStar.declare.opLabel')}
            </Text>
            <Select
              value={op}
              options={(['gte', 'lte', 'gt', 'lt', 'eq'] as const).map((value) => ({
                label: t(`goalProcess.northStar.op.${value}` as const),
                value,
              }))}
              onChange={(value) => setOp(value as GoalMetricComparison)}
            />
          </Flexbox>
          <Flexbox flex={1} gap={6}>
            <Text fontSize={13} weight={500}>
              {t('goalProcess.northStar.declare.targetLabel')}
            </Text>
            <Input
              placeholder={'10000'}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onPressEnter={() => void submit()}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal justify={'flex-end'}>
          <Button
            disabled={!key.trim() || !Number.isFinite(Number(target)) || target.trim() === ''}
            loading={busy}
            type={'primary'}
            onClick={() => void submit()}
          >
            {initial
              ? t('goalProcess.northStar.edit.submit')
              : t('goalProcess.northStar.declare.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

DeclareMetricContent.displayName = 'DeclareMetricContent';

export const openDeclareMetricModal = (
  goalId: string,
  initial?: GoalMetricCriterion,
): ModalInstance =>
  createModal({
    content: <DeclareMetricContent goalId={goalId} initial={initial} />,
    footer: null,
    maskClosable: true,
    title: initial
      ? t('goalProcess.northStar.edit.title', { ns: 'chat' })
      : t('goalProcess.northStar.declare.title', { ns: 'chat' }),
    width: 'min(90%, 480px)',
  });
