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
    fontSize: 11.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chips: { columnGap: 4, display: 'flex', flexWrap: 'wrap', rowGap: 4 },
  heading: { fontSize: 15, fontWeight: 600, marginBlock: 0, wordBreak: 'break-all' },
  key: { color: cssVar.colorText, fontFamily: cssVar.fontFamilyCode, fontSize: 12.5 },
  list: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    backgroundColor: { ':hover': cssVar.colorFillQuaternary, 'default': 'transparent' },
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    color: 'inherit',
    columnGap: 12,
    display: 'grid',
    gridTemplateColumns: '160px auto 1fr minmax(0, 1.2fr)',
    paddingBlock: 10,
    paddingInline: 14,
    textDecorationLine: 'none',
  },
  sub: {
    color: cssVar.colorTextSecondary,
    fontSize: 12.5,
    marginBlockEnd: 12,
    marginBlockStart: 4,
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
    <section>
      <h2 {...stylex.props(styles.heading)}>{file}</h2>
      <div {...stylex.props(styles.sub)}>
        {list.length} 个用例
        {unpaired.length ? ` · ${unpaired.length} 个元素两侧配不上` : ''}
        。每行的小格子是这个用例在各条件下的结果，点开看证据链。
      </div>
      <div {...stylex.props(styles.list)}>
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
          <a href={hrefOf({ kind: 'review' })} key={item.key} {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.key)}>{shortKey(item.key)}</span>
            <span />
            <span {...stylex.props(styles.chips)}>
              <Chip tone="warn">{CATEGORY_LABELS.unpaired}</Chip>
              {item.signoff === 'valid' && <Chip tone="ok">已签收</Chip>}
            </span>
            <span />
          </a>
        ))}
      </div>
    </section>
  );
};
