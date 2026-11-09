import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import type { VerdictEntry } from '../api';
import { conditionColumns, type ReportCase } from '../data';
import { CATEGORY_LABELS, flagLabel, shortKey } from '../labels';
import { hrefOf } from '../route';
import { CATEGORY_TONES, Chip } from './Chip';
import { MatrixStrip } from './MatrixStrip';

const styles = stylex.create({
  cause: {
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chips: { columnGap: 4, display: 'flex', flexWrap: 'wrap', rowGap: 4 },
  heading: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeLG,
    fontWeight: 600,
    marginBlock: 0,
    wordBreak: 'break-all',
  },
  key: { color: cssVar.colorText, fontFamily: cssVar.fontFamilyCode, fontSize: cssVar.fontSizeSM },
  row: {
    alignItems: 'center',
    backgroundColor: { ':hover': cssVar.colorFillQuaternary, 'default': 'transparent' },
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: { ':first-child': 'none', 'default': 'solid' },
    borderBlockStartWidth: 1,
    color: 'inherit',
    columnGap: 12,
    display: 'grid',
    gridTemplateColumns: '180px auto minmax(0, 1fr) minmax(0, 1.2fr)',
    paddingBlock: 12,
    paddingInline: 16,
    textDecorationLine: 'none',
  },
});

const SIGNOFF_LABELS: Record<string, string> = { stale: '签收已失效', valid: '已签收' };

export const FileView = ({
  cases,
  conditions,
  file,
  items,
}: {
  cases: ReportCase[];
  conditions: string[];
  file: string;
  items: VerdictEntry[];
}) => {
  const columns = conditionColumns(conditions);
  const list = cases.filter((entry) => entry.plan.file === file);
  const unpaired = items.filter((item) => item.file === file && item.category === 'unpaired');
  const signoffOf = (key: string) => items.find((item) => item.key === key)?.signoff;
  return (
    <Flexbox gap={16}>
      <Flexbox gap={4}>
        <h1 {...stylex.props(styles.heading)}>{file}</h1>
        <Text type="secondary">
          {list.length} 个用例
          {unpaired.length ? `，${unpaired.length} 个元素两侧配不上` : ''}
          。小格子是这个用例在各条件下的结果，点一行看截图。
        </Text>
      </Flexbox>
      <Block style={{ overflow: 'hidden' }} variant="outlined">
        {list.map((entry) => {
          const [cause] = entry.result.rootCauses;
          const signoff = signoffOf(entry.key);
          return (
            <a
              href={hrefOf({ key: entry.key, kind: 'case' })}
              key={entry.key}
              {...stylex.props(styles.row)}
            >
              <span {...stylex.props(styles.key)}>{shortKey(entry.key)}</span>
              <MatrixStrip columns={columns} entry={entry} />
              <span {...stylex.props(styles.chips)}>
                <Chip tone={CATEGORY_TONES[entry.category]}>{CATEGORY_LABELS[entry.category]}</Chip>
                {signoff && SIGNOFF_LABELS[signoff] && (
                  <Chip tone={signoff === 'valid' ? 'ok' : 'bad'}>{SIGNOFF_LABELS[signoff]}</Chip>
                )}
                {[...entry.plan.flags, ...entry.result.gaps].map((flag) => (
                  <Chip key={flag} title={flag} tone="plain">
                    {flagLabel(flag)}
                  </Chip>
                ))}
              </span>
              <span {...stylex.props(styles.cause)}>
                {cause ? `${cause.property}: ${cause.before ?? '∅'} → ${cause.after ?? '∅'}` : ''}
              </span>
            </a>
          );
        })}
        {unpaired.map((item) => (
          <a
            href={hrefOf({ key: item.key, kind: 'review' })}
            key={item.key}
            {...stylex.props(styles.row)}
          >
            <span {...stylex.props(styles.key)}>{shortKey(item.key)}</span>
            <span />
            <span {...stylex.props(styles.chips)}>
              <Chip tone="warn">{CATEGORY_LABELS.unpaired}</Chip>
              {item.signoff === 'valid' && <Chip tone="ok">已签收</Chip>}
            </span>
            <span />
          </a>
        ))}
      </Block>
    </Flexbox>
  );
};
