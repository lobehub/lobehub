'use client';

import { CopyButton, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';
import { caseCriteria, type ComparisonCase } from './utils';

interface FieldProps {
  children?: string;
  empty?: string;
  /** Render the whole text instead of a scrollable excerpt. */
  full?: boolean;
  hint?: string;
  label: string;
}

const Field = memo<FieldProps>(({ children, empty, full, hint, label }) => (
  <Flexbox gap={6}>
    <Flexbox horizontal align="center" justify="space-between">
      <span className={styles.label}>{label}</span>
      {children && <CopyButton content={children} size="small" />}
    </Flexbox>
    {children ? (
      <div className={styles.prose} style={full ? { maxHeight: 'none' } : undefined}>
        {children}
      </div>
    ) : (
      <Text fontSize={12} type="secondary">
        {empty}
      </Text>
    )}
    {hint && (
      <Text fontSize={12} type="secondary">
        {hint}
      </Text>
    )}
  </Flexbox>
));

/**
 * The three things the judge reads besides the model's answer: the input, the
 * expected answer and the criteria. The criteria are stored as full text on the
 * case, so what is shown here is exactly what the judge was given.
 */
const CaseDefinition = memo<{
  /** Show input and expected output in full too (the cell detail drawer). */
  expanded?: boolean;
  testCase: ComparisonCase;
}>(({ expanded, testCase }) => {
  const { t } = useTranslation('eval');
  const content = testCase.content ?? {};

  return (
    <Flexbox gap={16}>
      <Field full={expanded} label={t('comparison.field.input')}>
        {content.input}
      </Field>
      <Field
        empty={t('testCaseDetail.expected.empty')}
        full={expanded}
        label={t('comparison.field.expected')}
      >
        {typeof content.expected === 'string' ? content.expected : undefined}
      </Field>
      {/* Never clipped: the criteria are the whole of what makes a verdict
          checkable, so they read in full wherever they are shown. */}
      <Field
        full
        empty={t('testCaseDetail.criteria.empty')}
        hint={t('comparison.field.criteriaHint')}
        label={t('comparison.field.criteria')}
      >
        {caseCriteria(testCase)}
      </Field>
    </Flexbox>
  );
});

CaseDefinition.displayName = 'EvalComparisonCaseDefinition';

export default CaseDefinition;
