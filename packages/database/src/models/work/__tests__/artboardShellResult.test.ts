// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { projects, tasks } from '../../../schemas';
import { ArtboardModel } from '../../artboard';
import { WorkModel } from '..';
import { parseArtboardShellCreate } from '../artboardShellResult';
import { cleanupWorkTestData, seedWorkTestData, serverDB, topicId, userId } from './_fixtures';

const projectId = 'prj_artboard_shell';
let artboardId: string;

beforeEach(async () => {
  await seedWorkTestData();
  await serverDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
  await serverDB.insert(tasks).values({
    createdByUserId: userId,
    id: 'task_artboard_shell',
    identifier: 'T-9',
    instruction: 'design onboarding',
    seq: 9,
  });
  const board = await new ArtboardModel(serverDB, userId).create({
    projectId,
    taskId: 'task_artboard_shell',
    title: '首次进入',
  });
  artboardId = board.id;
});

afterEach(async () => {
  await serverDB.delete(tasks).where(eq(tasks.id, 'task_artboard_shell'));
  await cleanupWorkTestData();
});

const line = () => `artboard ${artboardId} · revision 1 · 0 groups · 0 boards`;

describe('parseArtboardShellCreate', () => {
  it('reads the board id from a successful lh artboard create', () => {
    expect(
      parseArtboardShellCreate({
        command: `lh artboard create --title '首次进入'`,
        exitCode: 0,
        output: 'art_1 created\nartboard art_1 · revision 1 · 2 groups · 4 boards\n',
      }),
    ).toEqual({ artboardId: 'art_1' });
  });

  it('unwraps the codex shell wrapper and reads --json output', () => {
    expect(
      parseArtboardShellCreate({
        command: `/bin/zsh -lc "lh artboard create --title x --json"`,
        exitCode: 0,
        output: JSON.stringify({ artboard: { id: 'art_2', revision: 1 }, changedIds: [] }),
      }),
    ).toEqual({ artboardId: 'art_2' });
  });

  it('ignores failed runs, reads and updates', () => {
    const output = 'artboard art_3 · revision 2 · 1 groups · 1 boards';
    expect(
      parseArtboardShellCreate({ command: 'lh artboard create --title x', exitCode: 1, output }),
    ).toBeNull();
    expect(
      parseArtboardShellCreate({ command: 'lh artboard read art_3', exitCode: 0, output }),
    ).toBeNull();
    expect(
      parseArtboardShellCreate({
        command: `lh artboard update art_3 --revision 1 --ops '[]'`,
        exitCode: 0,
        output,
      }),
    ).toBeNull();
  });
});

describe('WorkModel.registerShellArtboardResult', () => {
  it('registers the created board under the run’s root operation', async () => {
    const work = await new WorkModel(serverDB, userId).registerShellArtboardResult({
      data: { command: `lh artboard create --title '首次进入'`, exitCode: 0, output: line() },
      messageId: null,
      rootOperationId: 'op-hetero-1',
      toolCallId: 'call-shell-1',
      toolIdentifier: 'codex',
      toolName: 'command_execution',
      topicId,
    });

    expect(work).toMatchObject({ resourceId: artboardId, title: '首次进入', type: 'artboard' });
    const summaries = await new WorkModel(serverDB, userId).listSummariesByRootOperations({
      includeArtboardWorks: true,
      rootOperationIds: ['op-hetero-1'],
    });
    expect(summaries['op-hetero-1']).toHaveLength(1);
  });

  it('registers nothing for a board id it cannot find', async () => {
    expect(
      await new WorkModel(serverDB, userId).registerShellArtboardResult({
        data: {
          command: 'lh artboard create --title x',
          exitCode: 0,
          output: 'artboard art_missing · revision 1 · 0 groups · 0 boards',
        },
        toolIdentifier: 'codex',
        toolName: 'command_execution',
      }),
    ).toBeNull();
  });
});
