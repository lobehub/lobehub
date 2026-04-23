import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcessRegistry } from '../registry';
import type { ProcessRegistryEvent } from '../types';

function makeChild(pid = 1234): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  (emitter as any).pid = pid;
  (emitter as any).kill = vi.fn();
  return emitter;
}

describe('ProcessRegistry', () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    registry = new ProcessRegistry();
  });

  it('registers a process and emits a registered event', () => {
    const events: ProcessRegistryEvent[] = [];
    registry.subscribe((e) => events.push(e));
    const child = makeChild();

    const entry = registry.register({
      command: 'ls',
      process: child,
      tags: { ownerModule: 'shell', topicId: 't1' },
    });

    expect(entry.pid).toBe(1234);
    expect(entry.status).toBe('running');
    expect(entry.tags.topicId).toBe('t1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('registered');
  });

  it('marks process as exited when child emits exit', () => {
    const child = makeChild();
    const entry = registry.register({
      command: 'ls',
      process: child,
      tags: { ownerModule: 'shell' },
    });
    const events: ProcessRegistryEvent[] = [];
    registry.subscribe((e) => events.push(e));

    child.emit('exit', 0);

    expect(entry.status).toBe('exited');
    expect(entry.exitCode).toBe(0);
    expect(events.some((e) => e.type === 'exited')).toBe(true);
  });

  it('filters list by tags and status', () => {
    registry.register({
      command: 'a',
      process: makeChild(1),
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    registry.register({
      command: 'b',
      process: makeChild(2),
      tags: { ownerModule: 'acp', topicId: 't1' },
    });
    registry.register({
      command: 'c',
      process: makeChild(3),
      tags: { ownerModule: 'shell', topicId: 't2' },
    });

    expect(registry.list({ topicId: 't1' })).toHaveLength(2);
    expect(registry.list({ ownerModule: 'shell' })).toHaveLength(2);
    expect(registry.list({ topicId: 't1', ownerModule: 'acp' })).toHaveLength(1);
    expect(registry.list({ status: 'running' })).toHaveLength(3);
  });

  it('rejects kill with empty filter', () => {
    expect(() => registry.kill({})).toThrow(/shellId/);
  });

  it('rejects kill by ownerModule alone (too broad)', () => {
    expect(() => registry.kill({ ownerModule: 'shell' })).toThrow(/ownerModule alone/);
  });

  it('accepts ownerModule when combined with a scope tag', () => {
    registry.register({
      command: 'a',
      process: makeChild(1),
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    expect(() => registry.kill({ ownerModule: 'shell', topicId: 't1' })).not.toThrow();
    killSpy.mockRestore();
  });

  it('returns only actually-killed shellIds (skips already-exited)', () => {
    const c1 = makeChild(1);
    registry.register({
      command: 'a',
      process: c1,
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    c1.emit('exit', 0); // exited before kill
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const killed = registry.kill({ topicId: 't1' });
    expect(killed).toHaveLength(0);
    killSpy.mockRestore();
  });

  it('marks process without pid as exited immediately', () => {
    const events: ProcessRegistryEvent[] = [];
    registry.subscribe((e) => events.push(e));
    const child = makeChild(0);
    (child as any).pid = undefined;
    const entry = registry.register({
      command: 'ghost',
      process: child,
      tags: { ownerModule: 'shell' },
    });
    expect(entry.status).toBe('exited');
    expect(events.map((e) => e.type)).toEqual(['registered', 'exited']);
  });

  it('cleanupAll emits killed events for running processes', () => {
    registry.register({
      command: 'a',
      process: makeChild(1),
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    const events: ProcessRegistryEvent[] = [];
    registry.subscribe((e) => events.push(e));
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    registry.cleanupAll();
    expect(events.some((e) => e.type === 'killed')).toBe(true);
    killSpy.mockRestore();
  });

  it('kills matching processes and marks them killed', () => {
    const c1 = makeChild(1);
    const c2 = makeChild(2);
    const c3 = makeChild(3);
    registry.register({
      command: 'a',
      process: c1,
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    registry.register({
      command: 'b',
      process: c2,
      tags: { ownerModule: 'shell', topicId: 't1' },
    });
    registry.register({
      command: 'c',
      process: c3,
      tags: { ownerModule: 'shell', topicId: 't2' },
    });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const killed = registry.kill({ topicId: 't1' });

    expect(killed).toHaveLength(2);
    expect(registry.list({ status: 'killed' })).toHaveLength(2);
    expect(registry.list({ status: 'running' })).toHaveLength(1);
    killSpy.mockRestore();
  });

  it('forget removes entry', () => {
    const child = makeChild();
    const entry = registry.register({
      command: 'ls',
      process: child,
      tags: { ownerModule: 'shell' },
    });
    registry.forget(entry.shellId);
    expect(registry.get(entry.shellId)).toBeUndefined();
  });

  it('unsubscribe stops further events', () => {
    const events: ProcessRegistryEvent[] = [];
    const unsubscribe = registry.subscribe((e) => events.push(e));
    unsubscribe();
    registry.register({
      command: 'ls',
      process: makeChild(),
      tags: { ownerModule: 'shell' },
    });
    expect(events).toHaveLength(0);
  });
});
