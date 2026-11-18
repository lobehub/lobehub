import type { GoalReportDetourKind } from '@lobechat/types';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  /**
   * Review: an outline is enough — no tinted fill, so the detour reads as a
   * callout beside the map rather than a filled warning block.
   */
  detour: {
    borderColor: cssVar.colorWarningBorder,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'dashed',
    borderWidth: 1,
    paddingBlock: 10,
    paddingInline: 12,
  },
});

export interface DetourCalloutProps {
  kind: GoalReportDetourKind;
  lesson: string;
  reason: string;
  title: string;
}

/** One detour a report chapter took: what strayed, why, and what it taught. */
const DetourCallout = memo<DetourCalloutProps>(({ kind, lesson, reason, title }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={4} {...stylex.props(styles.detour)}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Tag color={'warning'} size={'small'}>
          {t(`goalProcess.result.story.detourKind.${kind}`)}
        </Tag>
        <Text weight={600}>{title}</Text>
      </Flexbox>
      <Text fontSize={13}>{reason}</Text>
      <Text fontSize={13} type={'secondary'}>
        {`${t('goalProcess.result.story.lesson')}：${lesson}`}
      </Text>
    </Flexbox>
  );
});

DetourCallout.displayName = 'GoalReportDetourCallout';

export default DetourCallout;
