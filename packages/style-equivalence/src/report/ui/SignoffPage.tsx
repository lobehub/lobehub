import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { postSignoff, type RunPayload, shotUrl, type VerdictEntry } from '../api';
import { conditionColumns } from '../data';
import { FLAG_EXPLANATIONS, flagLabel, shortKey, SUBMIT_ERRORS } from '../labels';
import { hrefOf } from '../route';
import { type SignoffGroup, signoffGroups, signoffProgress, submission } from '../signoff';

const styles = stylex.create({
  button: {
    backgroundColor: { ':disabled': cssVar.colorFillTertiary, 'default': cssVar.colorText },
    borderRadius: 6,
    borderStyle: 'none',
    color: { ':disabled': cssVar.colorTextQuaternary, 'default': cssVar.colorBgContainer },
    cursor: { ':disabled': 'not-allowed', 'default': 'pointer' },
    fontFamily: 'inherit',
    fontSize: 12.5,
    height: 28,
    paddingInline: 12,
    whiteSpace: 'nowrap',
  },
  error: { color: cssVar.colorError, fontSize: 12.5 },
  explain: { color: cssVar.colorTextTertiary, flex: '1', fontSize: 12.5, minWidth: 0 },
  group: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 8,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
  },
  groupHead: {
    alignItems: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
    columnGap: 10,
    display: 'flex',
    paddingBlock: 10,
    paddingInline: 14,
  },
  head: { alignItems: 'baseline', columnGap: 12, display: 'flex' },
  key: { fontSize: 13, fontWeight: 500 },
  list: { display: 'grid', rowGap: 14 },
  muted: { color: cssVar.colorTextTertiary, fontSize: 12 },
  note: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorder,
    borderRadius: 6,
    borderStyle: 'solid',
    borderWidth: 1,
    color: cssVar.colorText,
    fontFamily: 'inherit',
    fontSize: 12.5,
    height: 28,
    paddingInline: 8,
    width: 260,
  },
  progress: { color: cssVar.colorTextSecondary, fontSize: 13, marginInlineStart: 'auto' },
  row: {
    alignItems: 'center',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
    columnGap: 12,
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 140px',
    paddingBlock: 8,
    paddingInline: 14,
  },
  shot: {
    backgroundColor: cssVar.colorBgLayout,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'block',
    height: 64,
    objectFit: 'contain',
    objectPosition: 'left top',
    width: '100%',
  },
  span2: { gridColumn: 'span 2' },
  state: {
    alignItems: 'center',
    columnGap: 8,
    display: 'flex',
    fontSize: 12,
    justifyContent: 'flex-end',
  },
  title: { fontSize: 15, fontWeight: 600, marginBlock: 0 },
  valid: { color: cssVar.colorSuccess },
});

const STATE_LABELS: Record<string, string> = {
  missing: '未签收',
  stale: '签收已失效',
  valid: '已签收',
};

const Row = ({
  checked,
  condition,
  item,
  onToggle,
}: {
  checked: boolean;
  condition?: string;
  item: VerdictEntry;
  onToggle: () => void;
}) => (
  <div {...stylex.props(styles.row)}>
    <input
      aria-label={`选择 ${shortKey(item.key)}`}
      checked={checked}
      disabled={item.signoff === 'valid'}
      type="checkbox"
      onChange={onToggle}
    />
    <div>
      <div {...stylex.props(styles.key)}>{shortKey(item.key)}</div>
      <div {...stylex.props(styles.muted)}>{item.file}</div>
    </div>
    {item.category === 'unpaired' || !condition ? (
      <div {...stylex.props(styles.muted, styles.span2)}>两侧配不上，没有可以并排的渲染。</div>
    ) : (
      (['base', 'head'] as const).map((side) => (
        <img
          alt={`${side} ${shortKey(item.key)}`}
          key={side}
          loading="lazy"
          src={shotUrl(item.key, side, condition, 0)}
          {...stylex.props(styles.shot)}
        />
      ))
    )}
    <div {...stylex.props(styles.state, item.signoff === 'valid' && styles.valid)}>
      {STATE_LABELS[item.signoff] ?? item.signoff}
      {item.category !== 'unpaired' && <a href={hrefOf({ key: item.key, kind: 'case' })}>详情 ›</a>}
    </div>
  </div>
);

const Group = ({
  condition,
  group,
  onVerdict,
}: {
  condition?: string;
  group: SignoffGroup;
  onVerdict: (verdict: RunPayload['verdict']) => void;
}) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : group.batch
          ? [...current, key]
          : [key],
    );
  const open = group.items.filter((item) => item.signoff !== 'valid').map((item) => item.key);
  const submit = async () => {
    const result = submission(group, selected, note);
    if ('error' in result) return setError(SUBMIT_ERRORS[result.error] ?? result.error);
    setBusy(true);
    try {
      onVerdict((await postSignoff(result.body)).verdict);
      setSelected([]);
      setError(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={flagLabel(group.reason)} {...stylex.props(styles.group)}>
      <div {...stylex.props(styles.groupHead)}>
        {group.batch && (
          <input
            aria-label="全选本组"
            checked={open.length > 0 && open.every((key) => selected.includes(key))}
            type="checkbox"
            onChange={(event) => setSelected(event.target.checked ? open : [])}
          />
        )}
        <b>{flagLabel(group.reason)}</b>
        <span {...stylex.props(styles.muted)}>{group.items.length}</span>
        <span {...stylex.props(styles.explain)}>
          {FLAG_EXPLANATIONS[group.reason]}{' '}
          <a href={hrefOf({ anchor: group.reason, kind: 'method' })}>依据 ›</a>
        </span>
        <input
          aria-label="签收说明"
          placeholder="说明：怎么确认的"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          {...stylex.props(styles.note)}
        />
        <button
          disabled={busy || !selected.length}
          type="button"
          onClick={submit}
          {...stylex.props(styles.button)}
        >
          签收{group.batch ? `选中的 ${selected.length} 条` : '这一条'}
        </button>
      </div>
      {error && <div {...stylex.props(styles.groupHead, styles.error)}>{error}</div>}
      {group.items.map((item) => (
        <Row
          checked={selected.includes(item.key)}
          condition={condition}
          item={item}
          key={item.key}
          onToggle={() => toggle(item.key)}
        />
      ))}
    </section>
  );
};

export const SignoffPage = ({
  onVerdict,
  payload,
}: {
  onVerdict: (verdict: RunPayload['verdict']) => void;
  payload: RunPayload;
}) => {
  const groups = signoffGroups(payload.verdict.items);
  const progress = signoffProgress(payload.verdict.items);
  const condition = conditionColumns(payload.run.conditions ?? []).find(
    (column) => column.state === 'default' && !column.variant,
  )?.label;
  return (
    <div {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.head)}>
        <h2 {...stylex.props(styles.title)}>签收</h2>
        <span {...stylex.props(styles.muted)}>
          按原因分组。签收记录绑定内容哈希，源码一变，对应的签收自动失效。缩略图是{' '}
          {condition ?? '默认条件'} 下的两侧渲染。
        </span>
        <span {...stylex.props(styles.progress)}>
          已签 {progress.signed} / {progress.total}
        </span>
      </div>
      {groups.length === 0 && (
        <div {...stylex.props(styles.muted)}>这次运行没有需要签收的用例。</div>
      )}
      {groups.map((group) => (
        <Group condition={condition} group={group} key={group.reason} onVerdict={onVerdict} />
      ))}
    </div>
  );
};
