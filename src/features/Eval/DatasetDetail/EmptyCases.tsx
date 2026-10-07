'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Database, FileUp, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';

import { styles } from './style';

interface EmptyCasesProps {
  onAdd: () => void;
  onImport: () => void;
}

/** First-use state of a dataset: the two ways cases get here, and one action. */
const EmptyCases = ({ onAdd, onImport }: EmptyCasesProps) => {
  const { t } = useTranslation('eval');

  return (
    <EvalEmpty
      description={t('dataset.empty.cases.description')}
      icon={Database}
      title={t('dataset.empty.cases.title')}
      action={
        <Flexbox align="center" gap={16} style={{ width: '100%' }}>
          <div className={styles.waysGrid}>
            <Flexbox className={styles.way} gap={4}>
              <span className={styles.wayTitle}>{t('dataset.empty.cases.fromChat.title')}</span>
              <span className={styles.muted}>{t('dataset.empty.cases.fromChat.description')}</span>
            </Flexbox>
            <Flexbox className={styles.way} gap={4}>
              <span className={styles.wayTitle}>{t('dataset.empty.cases.manual.title')}</span>
              <span className={styles.muted}>{t('dataset.empty.cases.manual.description')}</span>
            </Flexbox>
          </div>
          <Flexbox horizontal gap={8}>
            <Button icon={Plus} type="primary" onClick={onAdd}>
              {t('testCase.actions.add')}
            </Button>
            <Button icon={FileUp} type="text" onClick={onImport}>
              {t('dataset.actions.import')}
            </Button>
          </Flexbox>
        </Flexbox>
      }
    />
  );
};

export default EmptyCases;
