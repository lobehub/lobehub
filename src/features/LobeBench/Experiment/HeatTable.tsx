'use client';

import { Block, Flexbox, Text, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { formatPercent, type LobeBenchContender } from '@/features/LobeBench/lobeBench';
import { sx } from '@/styles/sx';

import { heatStyle } from './heatStyle';

const styles = stylex.create({
  tableScroll: { overflowX: 'auto', minWidth: 0, maxWidth: '100%' },
  grid: { display: 'grid', columnGap: 8, rowGap: 2, alignItems: 'center' },
  head: {
    paddingBlock: 6,
    paddingInline: 8,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
  },
  cell: { paddingBlock: 8, paddingInline: 8, borderRadius: cssVar.borderRadius },
  heat: {
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
  },
});

interface HeatTableProps<Row extends string> {
  contenders: LobeBenchContender[];
  hint: string;
  label: (row: Row) => string;
  onSelect: (row: Row) => void;
  rate: (contender: LobeBenchContender, row: Row) => number | undefined;
  rows: Row[];
  title: string;
}

/** Pass rate per row (a category or a level) for each contender, one coloured cell each. */
export const HeatTable = <Row extends string>({
  contenders,
  hint,
  label,
  onSelect,
  rate,
  rows,
  title,
}: HeatTableProps<Row>) => {
  const theme = useTheme();

  return (
    <Block className={stylex.props(styles.tableScroll).className} padding={12} variant={'outlined'}>
      <Flexbox gap={8}>
        <Flexbox gap={2}>
          <Text weight={600}>{title}</Text>
          <Text fontSize={12} type={'secondary'}>
            {hint}
          </Text>
        </Flexbox>
        <div
          className={stylex.props(styles.grid).className}
          style={{
            gridTemplateColumns: `minmax(140px, 1fr) ${contenders.map(() => 'minmax(90px, 1fr)').join(' ')}`,
            minWidth: Math.max(380, 160 + contenders.length * 120),
          }}
        >
          <span />
          {contenders.map((c) => (
            <Text
              ellipsis
              className={stylex.props(styles.head).className}
              key={c.id}
              style={{ textAlign: 'center' }}
            >
              {c.name.split(' · ')[0]}
            </Text>
          ))}
          {rows.map((row) => [
            <Text
              ellipsis
              className={stylex.props(styles.cell).className}
              fontSize={13}
              key={`${row}-label`}
            >
              {label(row)}
            </Text>,
            ...contenders.map((c) => {
              const value = rate(c, row);
              return (
                <div
                  key={`${row}-${c.id}`}
                  role={'button'}
                  tabIndex={0}
                  {...sx(styles.heat, heatStyle(value, theme))}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelect(row);
                  }}
                >
                  {value === undefined ? '—' : formatPercent(value)}
                </div>
              );
            }),
          ])}
        </div>
      </Flexbox>
    </Block>
  );
};
