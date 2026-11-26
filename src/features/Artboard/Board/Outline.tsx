import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  File,
  FoldVertical,
  RectangleHorizontal,
  UnfoldVertical,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { artboardActions, useArtboardStore } from '../store';
import { floatStyles } from '../Viewport/floatStyles';

const styles = stylex.create({
  panel: {
    insetBlockStart: 12,
    insetInlineStart: 12,
    width: { 'default': 244, '@media (max-width: 520px)': 210 },
    maxWidth: 'calc(100% - 24px)',
    maxHeight: 'calc(100% - 64px)',
    padding: 0,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontSize: 12,
    lineHeight: '16px',
    color: cssVar.colorText,
  },
  button: {
    alignItems: 'center',
    display: 'flex',
    appearance: 'none',
    borderWidth: 0,
    borderRadius: 4,
    font: 'inherit',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    outlineColor: cssVar.colorText,
  },
  page: {
    width: '100%',
    minHeight: 43,
    paddingInline: 12,
    paddingBlock: 8,
    gap: 9,
    flexShrink: 0,
    borderRadius: 0,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    fontWeight: 600,
  },
  pageIcon: {
    display: 'grid',
    placeItems: 'center',
    width: 24,
    height: 24,
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: 6,
    flexShrink: 0,
  },
  grow: { flex: '1', minWidth: 0 },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingInline: 12,
    minHeight: 32,
    flexShrink: 0,
    color: cssVar.colorTextSecondary,
    fontSize: 11,
  },
  count: { fontSize: 11, fontVariantNumeric: 'tabular-nums', color: cssVar.colorTextSecondary },
  toggle: {
    marginInlineStart: 'auto',
    height: 24,
    width: 24,
    justifyContent: 'center',
    padding: 0,
  },
  list: {
    minHeight: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    paddingInline: 5,
    paddingBlockEnd: 6,
  },
  row: { width: '100%', paddingInline: 7, paddingBlock: 5, gap: 6, minHeight: 28 },
  groupRow: { display: 'flex', alignItems: 'center' },
  caret: { width: 22, padding: 0, minHeight: 28, flexShrink: 0, justifyContent: 'center' },
  groupTitle: { overflowWrap: 'anywhere', fontWeight: 600, flex: '1' },
  children: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
    marginInlineStart: 12,
    paddingInlineStart: 7,
    marginBlockEnd: 4,
  },
  member: {
    width: '100%',
    gap: 7,
    minHeight: 24,
    paddingBlock: 3,
    paddingInline: 6,
    color: cssVar.colorTextSecondary,
  },
  name: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fixed: { flexShrink: 0 },
  active: {
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  open: { transform: 'rotate(90deg)' },
});

const Outline = () => {
  const { t } = useTranslation('project');
  const model = useBoard();
  const selected = useArtboardStore((s) => s.selected);
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = model.pages.find((p) => p.id === model.pageId);
  const groups = model.groups
    .map((g) => ({
      id: g.id,
      title: g.title,
      members: model.boards.filter((b) => b.groupId === g.id),
    }))
    .filter((g) => g.members.length);
  const loose = model.boards.filter((b) => !b.groupId);
  const otherId = `ungrouped-${model.pageId}`;
  if (loose.length)
    groups.push({ id: otherId, title: t('artboard.outline.other'), members: loose });
  const isOpen = (id: string) => expanded[id] ?? id === groups[0]?.id;
  const anyOpen = groups.some((g) => isOpen(g.id));
  const toggle = (id: string) => setExpanded({ ...expanded, [id]: !isOpen(id) });
  useEffect(() => {
    if (!picker) return;
    list.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !panel.current?.contains(e.target)) setPicker(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [picker]);
  const navigate = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && picker) {
      e.stopPropagation();
      setPicker(false);
      trigger.current?.focus();
      return;
    }
    const buttons = Array.from(list.current?.querySelectorAll('button') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = (
      {
        Home: 0,
        End: buttons.length - 1,
        ArrowUp: (i + buttons.length - 1) % buttons.length,
        ArrowDown: (i + 1) % buttons.length,
      } as Record<string, number>
    )[e.key];
    if (next === undefined) return;
    e.preventDefault();
    buttons[next].focus();
  };
  return (
    <nav
      aria-label={t('artboard.outline.title')}
      data-artboard-outline=""
      ref={panel}
      onKeyDown={navigate}
      {...stylex.props(floatStyles.float, styles.panel)}
    >
      {current && (
        <button
          aria-expanded={picker}
          disabled={model.pages.length < 2}
          ref={trigger}
          type="button"
          onClick={() => setPicker(!picker)}
          {...stylex.props(styles.button, styles.page)}
        >
          <span {...stylex.props(styles.pageIcon)}>
            <File size={15} />
          </span>
          <span {...stylex.props(styles.grow, styles.name)}>{current.name}</span>
          {model.pages.length > 1 && <ChevronsUpDown size={13} />}
        </button>
      )}
      {picker ? (
        <div ref={list} {...stylex.props(styles.list)}>
          {model.pages.map((p, i) => (
            <button
              aria-current={p.id === model.pageId ? 'page' : undefined}
              key={p.id}
              type="button"
              onClick={() => {
                artboardActions.setPage(p.id);
                setPicker(false);
                trigger.current?.focus();
              }}
              {...stylex.props(styles.button, styles.row, p.id === model.pageId && styles.active)}
            >
              <span {...stylex.props(styles.count)}>{String(i + 1).padStart(2, '0')}</span>
              <span {...stylex.props(styles.grow)}>{p.name}</span>
              {p.id === model.pageId && <Check size={13} />}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div {...stylex.props(styles.header)}>
            {t('artboard.outline.title')}
            <span {...stylex.props(styles.count)}>{model.boards.length}</span>
            {groups.length > 0 && (
              <button
                type="button"
                aria-label={t(
                  anyOpen ? 'artboard.outline.collapseAll' : 'artboard.outline.expandAll',
                )}
                onClick={() =>
                  setExpanded({
                    ...expanded,
                    ...Object.fromEntries(groups.map((g) => [g.id, !anyOpen])),
                  })
                }
                {...stylex.props(styles.button, styles.toggle)}
              >
                {anyOpen ? <FoldVertical size={14} /> : <UnfoldVertical size={14} />}
              </button>
            )}
          </div>
          <div key={model.pageId} ref={list} {...stylex.props(styles.list)}>
            {groups.map((g) => (
              <section key={g.id}>
                <div {...stylex.props(styles.groupRow)}>
                  <button
                    aria-expanded={isOpen(g.id)}
                    aria-label={g.title}
                    type="button"
                    onClick={() => toggle(g.id)}
                    {...stylex.props(styles.button, styles.caret)}
                  >
                    <ChevronRight size={12} {...stylex.props(isOpen(g.id) && styles.open)} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toggle(g.id);
                      if (g.id !== otherId) artboardActions.focus({ id: g.id, kind: 'group' });
                    }}
                    {...stylex.props(styles.button, styles.row, styles.grow)}
                  >
                    <span {...stylex.props(styles.groupTitle)}>{g.title}</span>
                    <span {...stylex.props(styles.count)}>{g.members.length}</span>
                  </button>
                </div>
                {isOpen(g.id) && (
                  <div {...stylex.props(styles.children)}>
                    {g.members.map((b) => (
                      <button
                        aria-current={selected === b.id || undefined}
                        key={b.id}
                        title={b.title}
                        type="button"
                        onClick={() => artboardActions.focusItem(b.id)}
                        {...stylex.props(
                          styles.button,
                          styles.member,
                          selected === b.id && styles.active,
                        )}
                      >
                        <RectangleHorizontal size={11} {...stylex.props(styles.fixed)} />
                        <span {...stylex.props(styles.name)}>{b.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </nav>
  );
};
export default Outline;
