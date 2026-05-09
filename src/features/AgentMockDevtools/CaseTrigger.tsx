import type { MockCase } from '@lobechat/agent-mock';
import { Flexbox, Input, Popover, Text, usePopoverContext } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';

import { useMockCases } from './hooks/useMockCases';
import { useAgentMockStore } from './store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding: 16px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  group: css`
    padding-block: 8px 4px;
    padding-inline: 12px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px;
    padding-inline: 12px;
    border-inline-start: 1px solid transparent;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemActive: css`
    border-inline-start-color: ${cssVar.colorText};
    font-weight: 500;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  itemMeta: css`
    flex-shrink: 0;
    font-size: 11px;
    font-feature-settings: 'tnum';
    color: ${cssVar.colorTextTertiary};
  `,
  itemName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  list: css`
    overflow-y: auto;
    max-height: 360px;
    padding-block: 4px;
  `,
  panel: css`
    width: 320px;
  `,
  search: css`
    padding-block: 8px 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trigger: css`
    cursor: pointer;
    user-select: none;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    max-width: 240px;
    padding-block: 4px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  triggerName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  triggerPlaceholder: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

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
    <div className={styles.panel}>
      <div className={styles.search}>
        <Input
          autoFocus
          placeholder="Search cases…"
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={styles.list}>
        {totalVisible === 0 && <div className={styles.empty}>No cases match.</div>}
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <Flexbox key={group.key} style={{ paddingBlockEnd: 4 }}>
              <div className={styles.group}>
                {group.label} ({group.items.length})
              </div>
              {group.items.map((c) => {
                const active = selectedCaseId === c.id;
                const events = sourceEvents(c).length;
                const tools = countTools(c);
                return (
                  <div
                    className={`${styles.item} ${active ? styles.itemActive : ''}`}
                    key={c.id}
                    onClick={() => handlePick(c.id)}
                  >
                    <span className={styles.itemName}>{c.name}</span>
                    <span className={styles.itemMeta}>
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
        <span className={styles.trigger}>
          {current ? (
            <span className={styles.triggerName}>{current.name}</span>
          ) : (
            <Text className={styles.triggerPlaceholder}>Pick a case</Text>
          )}
          <ChevronDown size={12} />
        </span>
      )}
    </Popover>
  );
});

CaseTrigger.displayName = 'AgentMockCaseTrigger';
