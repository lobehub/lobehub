import { CopyButton, Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    flex-shrink: 0;
    width: 360px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  content: css`
    overflow-y: auto;
    flex: 1;
    padding: 16px;
  `,
  fieldLabel: css`
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  fieldValue: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: 8px;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  title: css`
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface TestCasePreviewPanelProps {
  onClose: () => void;
  testCase: any;
}

const TestCasePreviewPanel = memo<TestCasePreviewPanelProps>(({ testCase, onClose }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={styles.container} height="100%">
      <div className={styles.header}>
        <p className={styles.title}>{t('testCase.preview.title')}</p>
        <Button
          icon={<X size={14} />}
          size="small"
          style={{ color: cssVar.colorTextTertiary, height: 28, padding: 0, width: 28 }}
          type="text"
          onClick={onClose}
        />
      </div>
      <div className={styles.content}>
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Flexbox horizontal align="center" justify="space-between">
              <p className={styles.fieldLabel}>{t('testCase.preview.input')}</p>
              {testCase.content?.input && (
                <CopyButton content={testCase.content.input} size="small" />
              )}
            </Flexbox>
            <div className={styles.fieldValue}>{testCase.content?.input}</div>
          </Flexbox>
          {testCase.content?.expected && (
            <Flexbox gap={4}>
              <Flexbox horizontal align="center" justify="space-between">
                <p className={styles.fieldLabel}>{t('testCase.preview.expected')}</p>
                <CopyButton content={testCase.content.expected} size="small" />
              </Flexbox>
              <div className={styles.fieldValue}>{testCase.content.expected}</div>
            </Flexbox>
          )}
          {testCase.content?.category && (
            <Flexbox gap={4}>
              <p className={styles.fieldLabel}>{t('table.columns.category')}</p>
              <div className={styles.fieldValue}>{testCase.content.category}</div>
            </Flexbox>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

export default TestCasePreviewPanel;
