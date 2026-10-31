import type { MockCase } from '@lobechat/agent-mock';
import { Flexbox, Input, Popover, Text, usePopoverContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';

import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const styles = stylex.create({
  empty: {
    padding: '16px',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textAlign: 'center',
  },
  group: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
    paddingInline: '12px',
    fontSize: '11px',
    fontWeight: 500,
    color: cssVar.colorTextTertiary,
  },
  item: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'transparent',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  itemActive: {
    borderInlineStartColor: cssVar.colorText,
    fontWeight: 500,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  itemMeta: {
    flexShrink: 0,
    fontSize: '11px',
    fontFeatureSettings: "'tnum'",
    color: cssVar.colorTextTertiary,
  },
  itemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  list: { overflowY: 'auto', maxHeight: '360px', paddingBlock: '4px' },
  panel: { width: '320px' },
  search: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '4px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  trigger: {
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    gap: '6px',
    alignItems: 'center',
    maxWidth: '240px',
    paddingBlock: '4px',
    paddingInline: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  triggerName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  triggerPlaceholder: { color: cssVar.colorTextTertiary },
});

const countTools = (c: MockCase): number => {
  if (typeof c.meta?.toolCount === 'number') return c.meta.toolCount;
  const events = sourceEvents(c);
  return events.filter((e) => e.type === 'tool_start').length;
};

const sourceEvents = (c: MockCase) => {
  if (c.source.type === 'fixture') return c.source.events;
  if (c.source.type === 'snapshot') return c.source.events ?? [];
  if (c.source.type === 'generator') return c.source.events ?? [];
  return [];
};

interface CasePanelProps {
  selectedCaseId: string | null;
  setSelectedCaseId: (id: string) => void;
}

const CasePanel = memo<CasePanelProps>(({ selectedCaseId, setSelectedCaseId }) => {
  const { builtins, snapshots, generated } = useMockCases();
  const { close } = usePopoverContext();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.toLowerCase();
    const match = (arr: MockCase[]) =>
      needle ? arr.filter((c) => c.name.toLowerCase().includes(needle)) : arr;
    return [
      { items: match(builtins), key: 'builtin', label: 'Builtin' },
      { items: match(snapshots), key: 'snapshots', label: 'Snapshots' },
      { items: match(generated), key: 'generated', label: 'Generated' },
    ];
  }, [builtins, snapshots, generated, query]);

  const totalVisible = groups.reduce((sum, g) => sum + g.items.length, 0);

  const handlePick = (id: string) => {
    setSelectedCaseId(id);
    close();
  };

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.search)}>
        <Input
          autoFocus
          placeholder="Search cases…"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div {...stylex.props(styles.list)}>
        {totalVisible === 0 && <div {...stylex.props(styles.empty)}>No cases match.</div>}
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <Flexbox key={group.key} style={{ paddingBlockEnd: 4 }}>
              <div {...stylex.props(styles.group)}>
                {group.label} ({group.items.length})
              </div>
              {group.items.map((c) => {
                const active = selectedCaseId === c.id;
                const events = sourceEvents(c).length;
                const tools = countTools(c);
                return (
                  <div
                    {...stylex.props(styles.item, active && styles.itemActive)}
                    key={c.id}
                    onClick={() => handlePick(c.id)}
                  >
                    <span {...stylex.props(styles.itemName)}>{c.name}</span>
                    <span {...stylex.props(styles.itemMeta)}>
                      {events}e · {tools}t
                    </span>
                  </div>
                );
              })}
            </Flexbox>
          ),
        )}
      </div>
    </div>
  );
});

CasePanel.displayName = 'AgentMockCasePanel';

interface CaseTriggerProps {
  children?: ReactNode;
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
}

export const CaseTrigger = memo<CaseTriggerProps>(({ children, placement = 'bottomLeft' }) => {
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);
  const setSelectedCaseId = useAgentMockStore((s) => s.setSelectedCaseId);
  const { all } = useMockCases();
  const current = all.find((c) => c.id === selectedCaseId);

  return (
    <Popover
      arrow={false}
      content={<CasePanel selectedCaseId={selectedCaseId} setSelectedCaseId={setSelectedCaseId} />}
      placement={placement}
      styles={{ content: { padding: 0 } }}
      trigger={['click']}
    >
      {children ?? (
        <span {...stylex.props(styles.trigger)}>
          {current ? (
            <span {...stylex.props(styles.triggerName)}>{current.name}</span>
          ) : (
            <Text className={stylex.props(styles.triggerPlaceholder).className}>Pick a case</Text>
          )}
          <ChevronDown size={12} />
        </span>
      )}
    </Popover>
  );
});

CaseTrigger.displayName = 'AgentMockCaseTrigger';
