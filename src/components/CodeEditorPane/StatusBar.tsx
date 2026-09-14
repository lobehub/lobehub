'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

import type { IndentStyle } from './indent';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    flex-shrink: 0;

    height: 24px;
    padding-inline: 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    line-height: 1;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
  `,
  button: css`
    cursor: pointer;

    height: 18px;
    padding-inline: 6px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 11px;
    line-height: 1;
    color: inherit;
    white-space: nowrap;

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  item: css`
    padding-inline: 6px;
    white-space: nowrap;
  `,
  readOnly: css`
    padding-inline: 6px;
    border-radius: ${cssVar.borderRadiusSM};
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillTertiary};
  `,
}));

export interface CursorPosition {
  column: number;
  line: number;
  /** Characters covered by the current selection; 0 when it is just a caret. */
  selectionLength: number;
}

interface StatusBarProps {
  cursor?: CursorPosition;
  indent: IndentStyle;
  languageLabel: string;
  lineWrapping: boolean;
  onLineWrappingChange: (next: boolean) => void;
  readOnly?: boolean;
}

const StatusBar = ({
  cursor,
  indent,
  languageLabel,
  lineWrapping,
  onLineWrappingChange,
  readOnly,
}: StatusBarProps) => {
  const { t } = useTranslation('components');

  return (
    <Flexbox horizontal align={'center'} className={styles.bar} justify={'space-between'}>
      <Flexbox horizontal align={'center'}>
        {readOnly && <span className={styles.readOnly}>{t('CodeEditorPane.readOnly')}</span>}
      </Flexbox>
      <Flexbox horizontal align={'center'}>
        {cursor && (
          <span className={styles.item}>
            {t('CodeEditorPane.cursor', { column: cursor.column, line: cursor.line })}
            {cursor.selectionLength > 0 &&
              ` ${t('CodeEditorPane.selected', { length: cursor.selectionLength })}`}
          </span>
        )}
        <span className={styles.item}>
          {t(indent.useTabs ? 'CodeEditorPane.tabSize' : 'CodeEditorPane.spaces', {
            size: indent.size,
          })}
        </span>
        <Tooltip title={t('CodeEditorPane.toggleWordWrap')}>
          <button
            aria-pressed={lineWrapping}
            className={styles.button}
            type={'button'}
            onClick={() => onLineWrappingChange(!lineWrapping)}
          >
            {t(lineWrapping ? 'CodeEditorPane.wrapOn' : 'CodeEditorPane.wrapOff')}
          </button>
        </Tooltip>
        <span className={styles.item}>{languageLabel}</span>
      </Flexbox>
    </Flexbox>
  );
};

StatusBar.displayName = 'StatusBar';

export default StatusBar;
