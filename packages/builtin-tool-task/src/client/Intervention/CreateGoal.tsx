'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { CreateGoalParams, GoalCriterionDraft } from '../../types';

const styles = createStaticStyles(({ css }) => ({
  criterion: css`
    padding-block: 9px;
    padding-inline: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  label: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  list: css`
    overflow: hidden;
    padding: 0;
  `,
  required: css`
    flex: none;

    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 6px;

    font-size: 11px;
    color: ${cssVar.colorInfo};

    background: ${cssVar.colorInfoBg};
  `,
}));

const CreateGoalIntervention = memo<BuiltinInterventionProps<CreateGoalParams>>(
  ({ args, onArgsChange }) => {
    const { t } = useTranslation('plugin');
    const patch = (value: Partial<CreateGoalParams>) => onArgsChange?.({ ...args, ...value });
    const updateCriterion = (index: number, value: Partial<GoalCriterionDraft>) =>
      patch({
        criteria: args.criteria.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...value } : item,
        ),
      });

    return (
      <Flexbox gap={14}>
        <Input
          value={args.name}
          variant={'borderless'}
          onChange={(event) => patch({ name: event.target.value })}
        />
        <TextArea
          autoSize={{ maxRows: 5, minRows: 2 }}
          value={args.instruction}
          onChange={(event) => patch({ instruction: event.target.value })}
        />

        <Flexbox gap={7}>
          <Text className={styles.label}>{t('builtins.lobe-task.goal.criteria')}</Text>
          <Block className={styles.list} variant={'outlined'}>
            {args.criteria.map((criterion, index) => (
              <Flexbox className={styles.criterion} gap={6} key={index}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Text className={styles.label}>C{index + 1}</Text>
                  <Input
                    style={{ flex: 1 }}
                    value={criterion.title}
                    variant={'borderless'}
                    onChange={(event) => updateCriterion(index, { title: event.target.value })}
                  />
                  <Button
                    className={styles.required}
                    size={'small'}
                    type={'text'}
                    onClick={() =>
                      updateCriterion(index, { required: !(criterion.required ?? true) })
                    }
                  >
                    {(criterion.required ?? true)
                      ? t('builtins.lobe-task.goal.required')
                      : t('builtins.lobe-task.goal.optional')}
                  </Button>
                  <ActionIcon
                    icon={Trash2}
                    size={'small'}
                    onClick={() =>
                      patch({
                        criteria: args.criteria.filter((_, itemIndex) => itemIndex !== index),
                      })
                    }
                  />
                </Flexbox>
                {criterion.verifierType === 'program' ? (
                  <TextArea
                    autoSize={{ maxRows: 4, minRows: 1 }}
                    placeholder={t('builtins.lobe-task.goal.script')}
                    value={String(criterion.verifierConfig?.command ?? '')}
                    onChange={(event) =>
                      updateCriterion(index, {
                        verifierConfig: {
                          ...criterion.verifierConfig,
                          command: event.target.value,
                        },
                      })
                    }
                  />
                ) : (
                  <TextArea
                    autoSize={{ maxRows: 4, minRows: 1 }}
                    placeholder={t('builtins.lobe-task.goal.instruction')}
                    value={criterion.instruction ?? ''}
                    onChange={(event) =>
                      updateCriterion(index, { instruction: event.target.value })
                    }
                  />
                )}
              </Flexbox>
            ))}
          </Block>
          <ActionIcon
            icon={Plus}
            title={t('builtins.lobe-task.goal.addCriterion')}
            onClick={() =>
              patch({
                criteria: [
                  ...args.criteria,
                  { onFail: 'auto_repair', required: false, title: '', verifierType: 'agent' },
                ],
              })
            }
          />
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={18}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text className={styles.label}>{t('builtins.lobe-task.goal.roundBudget')}</Text>
            <InputNumber
              min={2}
              size={'small'}
              value={args.maxIterations ?? undefined}
              onChange={(value) => patch({ maxIterations: value })}
            />
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text className={styles.label}>{t('builtins.lobe-task.goal.costBudget')}</Text>
            <InputNumber
              min={0}
              prefix={'$'}
              size={'small'}
              value={args.maxTotalCost ?? undefined}
              onChange={(value) => patch({ maxTotalCost: value })}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

CreateGoalIntervention.displayName = 'CreateGoalIntervention';

export default CreateGoalIntervention;
