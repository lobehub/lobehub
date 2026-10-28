// Fixture: an eval case sidebar shows the case's failure reason — an eval result field.
// Reduced from eval/bench/.../cases/[caseId]/features/InfoSidebar.
import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface EvalResult {
  error?: string;
  score?: number;
}

const CaseInfoSidebar = memo<{ evalResult?: EvalResult }>(({ evalResult }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox gap={16} padding={16} style={{ width: 320 }}>
      {evalResult?.error && (
        <Flexbox gap={8}>
          <Text fontSize={12} type={'secondary'} weight={500}>
            {t('caseDetail.failureReason')}
          </Text>
          <Text style={{ whiteSpace: 'pre-wrap' }} type={'danger'}>
            {evalResult.error}
          </Text>
        </Flexbox>
      )}
      <Text type={'secondary'}>{t('caseDetail.section.testCase')}</Text>
    </Flexbox>
  );
});

export default CaseInfoSidebar;
