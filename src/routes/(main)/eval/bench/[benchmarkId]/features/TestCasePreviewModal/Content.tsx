'use client';

import { Flexbox } from '@lobehub/ui';
import { Badge } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  previewBlock: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    line-height: 1.6;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillSecondary};
  `,
  previewLabel: css`
    margin: 0;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    letter-spacing: 0.02em;
    text-transform: uppercase;
  `,
}));

const getDifficultyBadge = (difficulty: string) => {
  const config: Record<string, { bg: string; color: string }> = {
    easy: {
      bg: cssVar.colorSuccessBg,
      color: cssVar.colorSuccess,
    },
    hard: {
      bg: cssVar.colorErrorBg,
      color: cssVar.colorError,
    },
    medium: {
      bg: cssVar.colorWarningBg,
      color: cssVar.colorWarning,
    },
  };

  const c = config[difficulty] || config.easy;
  return (
    <Badge
      style={{
        backgroundColor: c.bg,
        borderColor: c.color + '30',
        color: c.color,
        fontSize: 12,
        textTransform: 'capitalize',
      }}
    >
      {difficulty}
    </Badge>
  );
};

export interface TestCasePreviewContentProps {
  testCase: any;
}

const TestCasePreviewContent: FC<TestCasePreviewContentProps> = ({ testCase }) => {
  const { t } = useTranslation('eval');

  if (!testCase) return null;

  return (
    <Flexbox gap={16}>
      <Flexbox gap={4}>
        <p className={styles.previewLabel}>{t('testCase.preview.input')}</p>
        <div className={styles.previewBlock}>{testCase.content?.input}</div>
      </Flexbox>
      <Flexbox gap={4}>
        <p className={styles.previewLabel}>{t('testCase.preview.expected')}</p>
        <div className={styles.previewBlock}>{testCase.content?.expectedOutput || '-'}</div>
      </Flexbox>
      <Flexbox horizontal align="center" gap={8}>
        {testCase.metadata?.difficulty && getDifficultyBadge(testCase.metadata.difficulty)}
        {testCase.metadata?.tags?.map((tag: string) => (
          <Badge
            key={tag}
            style={{
              backgroundColor: 'transparent',
              borderColor: cssVar.colorBorder,
              color: cssVar.colorTextTertiary,
              fontSize: 12,
            }}
          >
            {tag}
          </Badge>
        ))}
      </Flexbox>
    </Flexbox>
  );
};

export default TestCasePreviewContent;
