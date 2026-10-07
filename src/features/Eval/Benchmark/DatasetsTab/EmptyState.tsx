import { Button } from '@lobehub/ui/base-ui';
import { Database, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';

interface EmptyStateProps {
  onAddDataset: () => void;
}

/** No dataset yet: creating one leads straight into importing its cases. */
const EmptyState = ({ onAddDataset }: EmptyStateProps) => {
  const { t } = useTranslation('eval');

  return (
    <EvalEmpty
      description={t('benchmark.datasets.empty.description')}
      icon={Database}
      title={t('dataset.empty.title')}
      action={
        <Button icon={Plus} type="primary" onClick={onAddDataset}>
          {t('dataset.actions.addDataset')}
        </Button>
      }
    />
  );
};

export default EmptyState;
