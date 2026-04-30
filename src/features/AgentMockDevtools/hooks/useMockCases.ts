import type { MockCase } from '@lobechat/agent-mock';
import { BUILTIN_CASES, snapshotToMockCase } from '@lobechat/agent-mock';
import useSWR from 'swr';

interface SnapshotIndex {
  files: string[];
}

export function useMockCases() {
  const { data: snapshots = [] } = useSWR<MockCase[]>(
    'agent-mock/snapshots',
    async () => {
      const idx: SnapshotIndex = await fetch('/api/dev/agent-tracing').then((r) => r.json());
      const cases: MockCase[] = [];
      for (const f of idx.files ?? []) {
        try {
          const snap = await fetch(`/api/dev/agent-tracing?file=${encodeURIComponent(f)}`).then(
            (r) => r.json(),
          );
          cases.push(snapshotToMockCase(snap, { id: f, name: f, path: f }));
        } catch {
          // skip malformed snapshots
        }
      }
      return cases;
    },
    { revalidateOnFocus: false },
  );

  const generated: MockCase[] = (() => {
    try {
      const raw = localStorage.getItem('LOBE_AGENT_MOCK_GENERATED');
      return raw ? (JSON.parse(raw) as MockCase[]) : [];
    } catch {
      return [];
    }
  })();

  return {
    builtins: BUILTIN_CASES,
    snapshots,
    generated,
    all: [...BUILTIN_CASES, ...snapshots, ...generated],
  };
}
