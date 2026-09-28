import { describe, expect, it } from 'vitest';

import { parseMemoryDump, type TraceEvent } from '../memoryDump';

const size = (bytes: number) => ({ effective_size: { value: bytes.toString(16) } });
const MB = 1024 * 1024;

const events: TraceEvent[] = [
  { args: { name: 'Browser' }, name: 'process_name', ph: 'M', pid: 1 },
  { args: { name: 'Renderer' }, name: 'process_name', ph: 'M', pid: 2 },
  {
    args: {
      dumps: {
        allocators: {
          'blink_objects/Node': { attrs: { object_count: { value: '9c9b' } } },
          'blink_objects/blink_gc': { attrs: size(10 * MB) },
          'global/abc': { attrs: size(50 * MB) },
          'shared_memory/abc': { attrs: size(50 * MB) },
          'v8': { attrs: size(300 * MB) },
          'v8/main': { attrs: size(298 * MB) },
          'v8/main/heap': { attrs: size(290 * MB) },
          'v8/main/heap/old_space': { attrs: size(200 * MB) },
          'v8/main/malloc': { attrs: size(8 * MB) },
          'v8/shared': { attrs: { size: { value: (2 * MB).toString(16) } } },
          'v8/tiny': { attrs: size(1024) },
        },
        process_totals: { private_footprint_bytes: (1000 * MB).toString(16) },
      },
    },
    ph: 'v',
    pid: 2,
  },
  { args: { dumps: { allocators: { malloc: { attrs: size(40 * MB) } } } }, ph: 'v', pid: 1 },
];

describe('parseMemoryDump', () => {
  it('should put the calling renderer first with a size-sorted allocator tree', () => {
    const dump = parseMemoryDump(events, 2);

    expect(dump.processes.map((p) => [p.pid, p.name, p.isCaller])).toEqual([
      [2, 'Renderer', true],
      [1, 'Browser', false],
    ]);

    const renderer = dump.processes[0];
    expect(renderer.privateFootprintBytes).toBe(1000 * MB);
    expect(renderer.residentBytes).toBeNull();
    expect(renderer.objectCounts).toEqual({ Node: 40_091 });
    expect(renderer.allocators).toEqual([
      {
        children: [
          {
            children: [
              { children: [], name: 'heap', sizeBytes: 290 * MB },
              { children: [], name: 'malloc', sizeBytes: 8 * MB },
            ],
            name: 'main',
            sizeBytes: 298 * MB,
          },
          { children: [], name: 'shared', sizeBytes: 2 * MB },
        ],
        name: 'v8',
        sizeBytes: 300 * MB,
      },
    ]);
  });

  it('should fall back to a pid label when the process name is missing', () => {
    const dump = parseMemoryDump([events[3]]);
    expect(dump.processes[0].name).toBe('pid 1');
    expect(dump.processes[0].isCaller).toBe(false);
  });
});
