import { Button } from '@lobehub/ui/base-ui';
import { Activity, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';

interface EmptyStateProps {
  /** Copy for the dataset page instead of the benchmark page. */
  dataset?: boolean;
  onCreate: () => void;
}

const EmptyState = ({ dataset, onCreate }: EmptyStateProps) => {
  const { t } = useTranslation('eval');

  return (
    <EvalEmpty
      description={t(dataset ? 'run.empty.description' : 'benchmark.runs.empty.description')}
      icon={Activity}
      title={t('run.empty.title')}
      action={
        <Button icon={Plus} type="primary" onClick={onCreate}>
          {t('run.actions.create')}
        </Button>
      }
    />
  );
};

export default EmptyState;
