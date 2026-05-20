import { Block, Flexbox, Text } from '@lobehub/ui';
import { Tag } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SubtaskGraphPlan {
  alreadyDone: string[];
  blockedByCycle: string[];
  blockedExternally: string[];
  cycles: string[];
  ineligible: string[];
  layers: string[][];
  totalRunnable: number;
}

interface Props {
  plan: SubtaskGraphPlan;
}

const RunSubtasksPreview = memo<Props>(({ plan }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={12} style={{ paddingBlock: 8 }}>
      <Text fontSize={13} style={{ color: cssVar.colorTextSecondary }}>
        {t('taskDetail.runAll.description')}
      </Text>

      <Flexbox gap={8}>
        {plan.layers.map((layer, index) => {
          const hint =
            index === 0
              ? t('taskDetail.runAll.layerHint.first')
              : t('taskDetail.runAll.layerHint.next', { prev: index });
          return (
            <Block
              gap={6}
              key={`layer-${index}`}
              paddingBlock={8}
              paddingInline={12}
              variant={'outlined'}
            >
              <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                <Text fontSize={13} weight={600}>
                  {t('taskDetail.runAll.layer', { index: index + 1 })}
                </Text>
                <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
                  {hint}
                </Text>
              </Flexbox>
              <Flexbox horizontal flex={'wrap'} gap={4}>
                {layer.map((id) => (
                  <Tag key={id} style={{ marginInlineEnd: 0 }}>
                    {id}
                  </Tag>
                ))}
              </Flexbox>
            </Block>
          );
        })}
      </Flexbox>

      {(plan.alreadyDone.length > 0 ||
        plan.ineligible.length > 0 ||
        plan.blockedExternally.length > 0) && (
        <Flexbox gap={4}>
          {plan.alreadyDone.length > 0 && (
            <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
              {t('taskDetail.runAll.skipped.alreadyDone', { count: plan.alreadyDone.length })}
            </Text>
          )}
          {plan.ineligible.length > 0 && (
            <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
              {t('taskDetail.runAll.skipped.ineligible', { count: plan.ineligible.length })}
            </Text>
          )}
          {plan.blockedExternally.length > 0 && (
            <Text fontSize={12} style={{ color: cssVar.colorTextDescription }}>
              {t('taskDetail.runAll.skipped.blockedExternally', {
                count: plan.blockedExternally.length,
              })}
            </Text>
          )}
        </Flexbox>
      )}

      {plan.cycles.length > 0 && (
        <Block paddingBlock={8} paddingInline={12} variant={'outlined'}>
          <Text fontSize={12} style={{ color: cssVar.colorWarning }}>
            {t('taskDetail.runAll.cycleWarning', {
              members: [...plan.cycles, ...plan.blockedByCycle].join(', '),
            })}
          </Text>
        </Block>
      )}
    </Flexbox>
  );
});

RunSubtasksPreview.displayName = 'RunSubtasksPreview';

export default RunSubtasksPreview;
