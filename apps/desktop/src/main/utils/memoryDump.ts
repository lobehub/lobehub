import type { MemoryDump, MemoryDumpNode, MemoryDumpProcess } from '@lobechat/electron-client-ipc';

interface TraceAttr {
  value: string;
}

interface TraceAllocator {
  attrs?: Record<string, TraceAttr>;
}

export interface TraceEvent {
  args?: {
    dumps?: {
      allocators?: Record<string, TraceAllocator>;
      process_totals?: Record<string, string>;
    };
    name?: string;
  };
  name?: string;
  ph: string;
  pid: number;
}

const MIN_NODE_BYTES = 64 * 1024;
const MAX_DEPTH = 3;
const SKIPPED_ROOTS = new Set(['global', 'shared_memory', 'blink_objects']);

const hex = (value: string | undefined) => (value === undefined ? null : parseInt(value, 16));

const insert = (roots: MemoryDumpNode[], path: string[], sizeBytes: number) => {
  let siblings = roots;
  for (const [index, segment] of path.entries()) {
    let node = siblings.find((candidate) => candidate.name === segment);
    if (!node) {
      node = { children: [], name: segment, sizeBytes: 0 };
      siblings.push(node);
    }
    if (index === path.length - 1) node.sizeBytes = sizeBytes;
    siblings = node.children;
  }
};

const sortTree = (nodes: MemoryDumpNode[]) => {
  nodes.sort((a, b) => b.sizeBytes - a.sizeBytes);
  for (const node of nodes) sortTree(node.children);
};

const buildProcess = (
  event: TraceEvent,
  name: string,
  callerPid: number | undefined,
): MemoryDumpProcess => {
  const { allocators = {}, process_totals: totals = {} } = event.args!.dumps!;
  const roots: MemoryDumpNode[] = [];
  const objectCounts: Record<string, number> = {};

  for (const [path, allocator] of Object.entries(allocators)) {
    const segments = path.split('/');
    if (segments[0] === 'blink_objects' && segments.length === 2) {
      const count = hex(allocator.attrs?.object_count?.value);
      if (count) objectCounts[segments[1]] = count;
      continue;
    }
    if (SKIPPED_ROOTS.has(segments[0]) || segments.length > MAX_DEPTH) continue;
    const size = hex((allocator.attrs?.effective_size ?? allocator.attrs?.size)?.value);
    if (size === null || size < MIN_NODE_BYTES) continue;
    insert(roots, segments, size);
  }
  sortTree(roots);

  return {
    allocators: roots,
    isCaller: event.pid === callerPid,
    name,
    objectCounts,
    pid: event.pid,
    privateFootprintBytes: hex(totals.private_footprint_bytes),
    residentBytes: hex(totals.resident_set_bytes),
  };
};

export const parseMemoryDump = (events: TraceEvent[], callerPid?: number): MemoryDump => {
  const names = new Map<number, string>();
  for (const event of events) {
    if (event.ph === 'M' && event.name === 'process_name' && event.args?.name)
      names.set(event.pid, event.args.name);
  }

  const seen = new Set<number>();
  const processes: MemoryDumpProcess[] = [];
  for (const event of events) {
    if (event.ph !== 'v' || !event.args?.dumps?.allocators || seen.has(event.pid)) continue;
    seen.add(event.pid);
    processes.push(buildProcess(event, names.get(event.pid) ?? `pid ${event.pid}`, callerPid));
  }
  processes.sort((a, b) => Number(b.isCaller) - Number(a.isCaller));

  return { capturedAt: Date.now(), processes };
};
