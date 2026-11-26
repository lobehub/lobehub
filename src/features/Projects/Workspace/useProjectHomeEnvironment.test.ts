import { describe, expect, it } from 'vitest';

import { orderExecutionEnvironments } from '@/features/Projects/WorkingDirectories/executionEnvironmentOrder';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { resolveProjectHomeEnvironment } from './useProjectHomeEnvironment';

const folder = (id: string, sortOrder = 0) => ({ id, sortOrder }) as unknown as ProjectDirectory;

describe('resolveProjectHomeEnvironment', () => {
  const ordered = orderExecutionEnvironments([folder('dir-a'), folder('dir-b')], 0);

  it('starts in the first folder of the project order that can take the conversation', () => {
    const picked = resolveProjectHomeEnvironment(ordered, undefined, (d) => d.id === 'dir-b');
    expect(picked.id).toBe('dir-b');
  });

  it('falls back to the cloud sandbox when no folder ahead of it is available', () => {
    expect(resolveProjectHomeEnvironment(ordered, undefined, () => false).kind).toBe('sandbox');
  });

  it('follows a sandbox placed first, even with an available folder', () => {
    const sandboxFirst = orderExecutionEnvironments([folder('dir-a', 1)], -1);
    expect(resolveProjectHomeEnvironment(sandboxFirst, undefined, () => true).kind).toBe('sandbox');
  });

  it("keeps the person's pick while the project still has it", () => {
    expect(resolveProjectHomeEnvironment(ordered, 'sandbox', () => true).kind).toBe('sandbox');
    expect(resolveProjectHomeEnvironment(ordered, 'dir-b', () => false).id).toBe('dir-b');
  });

  it('drops a pick the project no longer has', () => {
    expect(resolveProjectHomeEnvironment(ordered, 'gone', (d) => d.id === 'dir-a').id).toBe(
      'dir-a',
    );
  });
});
