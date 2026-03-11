import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

export interface StageObjectItem {
  icon?: ReactNode;
  text: string;
}
export type StageItem = string | StageObjectItem;

interface InitingProps {
  activeStage: number;
  stages: StageItem[];
}

const InitProgress = memo<InitingProps>(({ activeStage, stages }) => {
  const outStage = stages[activeStage];
  const percent = (activeStage / (stages.length - 1)) * 100;

  const stage = typeof outStage === 'string' ? { text: outStage } : outStage;

  return (
    <Center gap={8} width={180}>
      <Progress
        percent={parseInt(percent.toFixed(0))}
        showInfo={false}
        strokeColor={cssVar.colorPrimary}
      />
      <Flexbox horizontal align={'center'} gap={4}>
        {stage?.icon ? stage?.icon : <Icon spin icon={Loader2} />}
        <Text type={'secondary'}>{stage?.text}</Text>
      </Flexbox>
    </Center>
  );
});

export default InitProgress;
