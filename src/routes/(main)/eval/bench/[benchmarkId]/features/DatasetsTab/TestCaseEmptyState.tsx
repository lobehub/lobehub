import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Database, FileUp, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  emptyIcon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 48px;
    height: 48px;
    margin-block-end: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorPrimaryBg};
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
        <Database size={20} style={{ color: cssVar.colorPrimary }} />
      </div>
      <Text weight={600}>{t('testCase.empty.title')}</Text>
      <Text color={cssVar.colorTextTertiary} fontSize={12}>
        {t('testCase.empty.description')}
      </Text>
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
