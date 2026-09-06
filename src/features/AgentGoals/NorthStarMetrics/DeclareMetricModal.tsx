'use client';

import type { GoalMetricComparison } from '@lobechat/types';
import { Flexbox, Input } from '@lobehub/ui';
import {
  Button,
  createModal,
  type ModalInstance,
  Select,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGoalStore } from '@/store/goal';

/**
 * Declare one measured acceptance clause: "this series must reach this
 * number". The key doubles as the series name the probe / manual observations
 * write to, so declaring is enough — the first observation creates the series.
 */
const DeclareMetricContent = memo<{ goalId: string }>(({ goalId }) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const declareGoalMetric = useGoalStore((s) => s.declareGoalMetric);

  const [key, setKey] = useState('');
  const [op, setOp] = useState<GoalMetricComparison>('gte');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedKey = key.trim();
    const parsedTarget = Number(target);
    if (!trimmedKey || !Number.isFinite(parsedTarget) || busy) return;
    setBusy(true);
    try {
      await declareGoalMetric(goalId, { key: trimmedKey, op, target: parsedTarget });
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
          autoFocus
          placeholder={t('goalProcess.northStar.declare.keyPlaceholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
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
          {t('goalProcess.northStar.declare.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DeclareMetricContent.displayName = 'DeclareMetricContent';

export const openDeclareMetricModal = (goalId: string): ModalInstance =>
  createModal({
    content: <DeclareMetricContent goalId={goalId} />,
    footer: null,
    maskClosable: true,
    title: t('goalProcess.northStar.declare.title', { ns: 'chat' }),
    width: 'min(90%, 480px)',
  });
