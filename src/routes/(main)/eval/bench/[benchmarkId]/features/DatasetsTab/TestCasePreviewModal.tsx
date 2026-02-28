import { Flexbox } from '@lobehub/ui';
import { Badge, Modal } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface TestCasePreviewModalProps {
  onClose: () => void;
  open: boolean;
  testCase: any | null;
}

const getDifficultyBadge = (difficulty: string) => {
  const config: Record<string, { bg: string; color: string }> = {
    easy: {
      bg: 'var(--ant-color-success-bg)',
      color: 'var(--ant-color-success)',
    },
    hard: {
      bg: 'var(--ant-color-error-bg)',
      color: 'var(--ant-color-error)',
    },
    medium: {
      bg: 'var(--ant-color-warning-bg)',
      color: 'var(--ant-color-warning)',
    },
  };

  const c = config[difficulty] || config.easy;
  return (
    <Badge
      style={{
        backgroundColor: c.bg,
        borderColor: c.color + '30',
        color: c.color,
        fontSize: 11,
        textTransform: 'capitalize',
      }}
    >
      {difficulty}
    </Badge>
  );
};

const TestCasePreviewModal = memo<TestCasePreviewModalProps>(({ open, testCase, onClose }) => {
  const { t } = useTranslation('eval');

  return (
    <Modal footer={null} open={open} title={t('testCase.preview.title')} width={600} onCancel={onClose}>
      {testCase && (
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <p
              style={{
                color: 'var(--ant-color-text-tertiary)',
                fontSize: 12,
                fontWeight: 500,
                margin: 0,
                textTransform: 'uppercase',
              }}
            >
              {t('testCase.preview.input')}
            </p>
            <div
              style={{
                background: 'var(--ant-color-fill-secondary)',
                borderRadius: 8,
                color: 'var(--ant-color-text)',
                fontSize: 14,
                lineHeight: 1.6,
                padding: 12,
              }}
            >
              {testCase.content?.input}
            </div>
          </Flexbox>
          <Flexbox gap={4}>
            <p
              style={{
                color: 'var(--ant-color-text-tertiary)',
                fontSize: 12,
                fontWeight: 500,
                margin: 0,
                textTransform: 'uppercase',
              }}
            >
              {t('testCase.preview.expected')}
            </p>
            <div
              style={{
                background: 'var(--ant-color-fill-secondary)',
                borderRadius: 8,
                color: 'var(--ant-color-text)',
                fontSize: 14,
                lineHeight: 1.6,
                padding: 12,
              }}
            >
              {testCase.content?.expectedOutput || '-'}
            </div>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            {testCase.metadata?.difficulty && getDifficultyBadge(testCase.metadata.difficulty)}
            {testCase.metadata?.tags?.map((tag: string) => (
              <Badge
                key={tag}
                style={{
                  backgroundColor: 'transparent',
                  borderColor: 'var(--ant-color-border)',
                  color: 'var(--ant-color-text-tertiary)',
                  fontSize: 12,
                }}
              >
                {tag}
              </Badge>
            ))}
          </Flexbox>
        </Flexbox>
      )}
    </Modal>
  );
});

export default TestCasePreviewModal;
