import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Lightbulb } from 'lucide-react';
import { memo } from 'react';

import Time from '@/routes/(main)/home/features/components/Time';

import BriefCardActions from './BriefCardActions';
import BriefCardSummary from './BriefCardSummary';
import { BRIEF_TYPE_COLOR, BRIEF_TYPE_ICON } from './const';
import { type BriefItem } from './types';

const CSS_VAR_COLOR_MAP: Record<string, string> = {
  error: cssVar.colorError,
  result: cssVar.colorSuccess,
};

interface BriefCardProps {
  brief: BriefItem;
}

const BriefCard = memo<BriefCardProps>(({ brief }) => {
  const icon = BRIEF_TYPE_ICON[brief.type] || Lightbulb;
  const color =
    BRIEF_TYPE_COLOR[brief.type as keyof typeof BRIEF_TYPE_COLOR] ??
    CSS_VAR_COLOR_MAP[brief.type] ??
    cssVar.colorPrimary;

  return (
    <Block padding={16} style={{ borderRadius: cssVar.borderRadiusLG }} variant={'outlined'}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <Icon color={color} icon={icon} size={28} />
            <Text ellipsis fontSize={16} style={{ flex: 1 }} weight={500}>
              {brief.title}
            </Text>
          </Flexbox>
          <Time date={brief.createdAt} />
        </Flexbox>
        <BriefCardSummary summary={brief.summary} />
        <BriefCardActions
          briefId={brief.id}
          briefType={brief.type}
          resolvedAction={brief.resolvedAction}
          taskId={brief.taskId}
        />
      </Flexbox>
    </Block>
  );
});

export default BriefCard;
