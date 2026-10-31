import { ActionIcon, CopyButton, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  container: {
    flexShrink: 0,
    width: '360px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  content: { overflowY: 'auto', flex: '1', padding: '16px' },
  fieldLabel: {
    margin: '0',
    fontSize: cssVar.fontSizeSM,
    fontWeight: 600,
    color: cssVar.colorTextTertiary,
  },
  fieldValue: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    fontSize: cssVar.fontSize,
    lineHeight: 1.6,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  title: { margin: '0', fontSize: cssVar.fontSize, fontWeight: 500, color: cssVar.colorText },
});

interface TestCasePreviewPanelProps {
  onClose: () => void;
  testCase: any;
}

const TestCasePreviewPanel = memo<TestCasePreviewPanelProps>(({ testCase, onClose }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={stylex.props(styles.container).className} height="100%">
      <div {...stylex.props(styles.header)}>
        <p {...stylex.props(styles.title)}>{t('testCase.preview.title')}</p>
        <ActionIcon icon={X} size="small" onClick={onClose} />
      </div>
      <div {...stylex.props(styles.content)}>
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Flexbox horizontal align="center" justify="space-between">
              <p {...stylex.props(styles.fieldLabel)}>{t('testCase.preview.input')}</p>
              {testCase.content?.input && (
                <CopyButton content={testCase.content.input} size="small" />
              )}
            </Flexbox>
            <div {...stylex.props(styles.fieldValue)}>{testCase.content?.input}</div>
          </Flexbox>
          {testCase.content?.expected && (
            <Flexbox gap={4}>
              <Flexbox horizontal align="center" justify="space-between">
                <p {...stylex.props(styles.fieldLabel)}>{t('testCase.preview.expected')}</p>
                <CopyButton content={testCase.content.expected} size="small" />
              </Flexbox>
              <div {...stylex.props(styles.fieldValue)}>{testCase.content.expected}</div>
            </Flexbox>
          )}
          {testCase.content?.category && (
            <Flexbox gap={4}>
              <p {...stylex.props(styles.fieldLabel)}>{t('table.columns.category')}</p>
              <div {...stylex.props(styles.fieldValue)}>{testCase.content.category}</div>
            </Flexbox>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

export default TestCasePreviewPanel;
