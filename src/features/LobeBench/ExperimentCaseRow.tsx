import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { CSSProperties } from 'react';

import type { CaseAttempt } from './caseResults';

const styles = stylex.create({
  row: {
    display: 'grid',
    gridColumnEnd: '-1',
    gridColumnStart: '1',
    columnGap: 8,
    alignItems: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillQuaternary },
    color: 'inherit',
    fontFamily: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
  },
  cell: { paddingBlock: 8, paddingInline: 8, minWidth: 0 },
  index: {
    color: cssVar.colorTextQuaternary,
    fontFamily: cssVar.fontFamilyCode,
    marginInlineEnd: 8,
  },
  heat: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
});

interface ExperimentCaseRowProps {
  columns: string;
  index: number;
  onOpen: () => void;
  results: Array<{ id: string; label: string; style: CSSProperties }>;
  subtitle: string;
  title: string;
}

/** The whole result row is one native keyboard target, with no nested actions. */
export const ExperimentCaseRow = ({
  columns,
  index,
  onOpen,
  results,
  subtitle,
  title,
}: ExperimentCaseRowProps) => (
  <button
    className={stylex.props(styles.row).className}
    style={{ gridTemplateColumns: columns }}
    type={'button'}
    onClick={onOpen}
  >
    <Flexbox className={stylex.props(styles.cell).className} gap={2}>
      <Text ellipsis fontSize={13}>
        <span className={stylex.props(styles.index).className}>{index}</span>
        {title}
      </Text>
      <Text ellipsis fontSize={11} type={'secondary'}>
        {subtitle}
      </Text>
    </Flexbox>
    {results.map((result) => (
      <div className={stylex.props(styles.cell).className} key={result.id}>
        <div className={stylex.props(styles.heat).className} style={result.style}>
          {result.label}
        </div>
      </div>
    ))}
  </button>
);

export const verdictStyle = (verdict: CaseAttempt['verdict']) => {
  switch (verdict) {
    case 'passed': {
      return { background: cssVar.colorSuccessBg, color: cssVar.colorSuccessText };
    }
    case 'failed': {
      return { background: cssVar.colorErrorBg, color: cssVar.colorErrorText };
    }
    case 'judge_error':
    case 'error':
    case 'timeout': {
      return { background: cssVar.colorWarningBg, color: cssVar.colorWarningText };
    }
    default: {
      return { background: cssVar.colorFillQuaternary, color: cssVar.colorTextQuaternary };
    }
  }
};
