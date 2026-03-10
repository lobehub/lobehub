import { Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Database, FileUp, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  emptyIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    margin-block-end: 12px;
    border-radius: 50%;

    background: ${cssVar.colorFillSecondary};
  `,
}));

interface TestCaseEmptyStateProps {
  onAddCase: () => void;
  onImport: () => void;
}

const TestCaseEmptyState = memo<TestCaseEmptyStateProps>(({ onAddCase, onImport }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox align="center" gap={8} justify="center" style={{ padding: '48px 24px' }}>
      <div className={styles.emptyIcon}>
        <Database size={20} style={{ color: 'var(--ant-color-text-tertiary)' }} />
      </div>
      <p
        style={{
          color: 'var(--ant-color-text)',
          fontSize: 14,
          fontWeight: 500,
          margin: 0,
        }}
      >
        {t('testCase.empty.title')}
      </p>
      <p
        style={{
          color: 'var(--ant-color-text-tertiary)',
          fontSize: 12,
          margin: 0,
        }}
      >
        {t('testCase.empty.description')}
      </p>
      <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
        <Button icon={Plus} size="small" onClick={onAddCase}>
          {t('testCase.actions.add')}
        </Button>
        <Button icon={FileUp} size="small" type="primary" onClick={onImport}>
          {t('testCase.actions.import')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default TestCaseEmptyState;
