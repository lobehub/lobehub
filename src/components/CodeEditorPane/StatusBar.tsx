'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import type { IndentStyle } from './indent';

const styles = stylex.create({
  bar: {
    flexShrink: 0,
    height: '24px',
    paddingInline: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '11px',
    lineHeight: 1,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  button: {
    cursor: 'pointer',
    height: '18px',
    paddingInline: '6px',
    borderStyle: 'none',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: '11px',
    lineHeight: 1,
    color: { 'default': 'inherit', ':hover': cssVar.colorText },
    whiteSpace: 'nowrap',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  item: { paddingInline: '6px', whiteSpace: 'nowrap' },
  readOnly: {
    paddingInline: '6px',
    borderRadius: cssVar.borderRadiusSM,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

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
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.bar).className}
      justify={'space-between'}
    >
      <Flexbox horizontal align={'center'}>
        {readOnly && <span {...stylex.props(styles.readOnly)}>{t('CodeEditorPane.readOnly')}</span>}
      </Flexbox>
      <Flexbox horizontal align={'center'}>
        {cursor && (
          <span {...stylex.props(styles.item)}>
            {t('CodeEditorPane.cursor', { column: cursor.column, line: cursor.line })}
            {cursor.selectionLength > 0 &&
              ` ${t('CodeEditorPane.selected', { length: cursor.selectionLength })}`}
          </span>
        )}
        <span {...stylex.props(styles.item)}>
          {t(indent.useTabs ? 'CodeEditorPane.tabSize' : 'CodeEditorPane.spaces', {
            size: indent.size,
          })}
        </span>
        <Tooltip title={t('CodeEditorPane.toggleWordWrap')}>
          <button
            aria-pressed={lineWrapping}
            {...stylex.props(styles.button)}
            type={'button'}
            onClick={() => onLineWrappingChange(!lineWrapping)}
          >
            {t(lineWrapping ? 'CodeEditorPane.wrapOn' : 'CodeEditorPane.wrapOff')}
          </button>
        </Tooltip>
        <span {...stylex.props(styles.item)}>{languageLabel}</span>
      </Flexbox>
    </Flexbox>
  );
};

StatusBar.displayName = 'StatusBar';

export default StatusBar;
