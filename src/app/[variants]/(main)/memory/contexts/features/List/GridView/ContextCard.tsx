import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';
import ProgressIcon from '@/app/[variants]/(main)/memory/features/ProgressIcon';
import { type DisplayContextMemory } from '@/database/repositories/userMemory';

import ContextDropdown from '../../ContextDropdown';

interface ContextCardProps {
  context: DisplayContextMemory;
  onClick?: () => void;
}

const ContextCard = memo<ContextCardProps>(({ context, onClick }) => {
  const { t } = useTranslation('memory');

  return (
    <GridCard
      actions={<ContextDropdown id={context.id} />}
      capturedAt={context.capturedAt || context.updatedAt || context.createdAt}
      cate={context.type}
      title={context.title}
      badges={
        <>
          <ProgressIcon
            format={(percent) => `${t('filter.sort.scoreImpact')}: ${percent}%`}
            percent={(context.scoreImpact ?? 0) * 100}
          />
          <ProgressIcon
            format={(percent) => `${t('filter.sort.scoreUrgency')}: ${percent}%`}
            percent={(context.scoreUrgency ?? 0) * 100}
            strokeColor={
              (context.scoreUrgency ?? 0) >= 0.7 ? cssVar.colorError : cssVar.colorWarning
            }
          />
        </>
      }
      onClick={onClick}
    >
      {context.description}
    </GridCard>
  );
});

export default ContextCard;
