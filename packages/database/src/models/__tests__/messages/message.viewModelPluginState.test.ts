// @vitest-environment node
import { LOADING_FLAT } from '@lobechat/const';
import { projectToolViewModels } from '@lobechat/tool-view-model';
import { MessageGroupType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messageGroups, messagePlugins, messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';
import { VIEW_MODEL_REDUCED_TOOLS } from '../../message/viewModelPluginState';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'view-model-plugin-state-user';
const topicId = 'vmps-topic';
const messageModel = new MessageModel(serverDB, userId);

const big = (label: string, size = 5000) => `${label}:`.padEnd(size, 'x');
// Astral characters count twice in UTF-16 (JS) but once in Postgres `length()`.
const astralPage = '😀'.repeat(150) + 'y'.repeat(300);

interface ToolRow {
  apiName: string;
  content: string;
  id: string;
  identifier: string;
  state: unknown;
}

const toolRows: ToolRow[] = [
  {
    apiName: 'runCommand',
    content: big('run body'),
    id: 'run',
    identifier: 'lobe-local-system',
    state: { exitCode: 0, output: big('out'), stdout: big('stdout'), success: true },
  },
  {
    apiName: 'command_execution',
    content: big('codex body'),
    id: 'codex',
    identifier: 'codex',
    state: { exitCode: 0, output: big('codex out') },
  },
  // Empty body: the projector decides from `stdout`, so the row must stay whole.
  {
    apiName: 'runCommand',
    content: '',
    id: 'run-empty-body',
    identifier: 'lobe-local-system',
    state: { exitCode: 0, stdout: big('stdout only') },
  },
  // Still running: never projected, so never reduced.
  {
    apiName: 'runCommand',
    content: LOADING_FLAT,
    id: 'run-loading',
    identifier: 'lobe-local-system',
    state: { stdout: big('partial') },
  },
  {
    apiName: 'readDocument',
    content: big('doc body'),
    id: 'doc',
    identifier: 'lobe-agent-documents',
    state: { content: big('doc'), id: 'docs_1', title: 'Spec', xml: big('<doc>') },
  },
  {
    apiName: 'readFile',
    content: big('file body'),
    id: 'file',
    identifier: 'lobe-local-system',
    state: {
      charCount: 5000,
      content: big('file'),
      images: [{ url: 'https://example.com/a.png' }],
      path: '/a.ts',
    },
  },
  // No stored `charCount`: the projector counts the body, so it must stay.
  {
    apiName: 'readFile',
    content: big('file body'),
    id: 'file-no-count',
    identifier: 'lobe-local-system',
    state: { content: astralPage, path: '/b.ts' },
  },
  {
    apiName: 'grepContent',
    content: big('grep body'),
    id: 'grep',
    identifier: 'lobe-cloud-sandbox',
    state: { matches: Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`), totalMatches: 50 },
  },
  {
    apiName: 'crawlMultiPages',
    content: big('crawl body'),
    id: 'crawl',
    identifier: 'lobe-web-browsing',
    state: {
      results: [
        { crawler: 'naive', data: { content: big('page'), length: 5000, title: 'A' } },
        { crawler: 'naive', data: { content: astralPage, length: astralPage.length, title: 'B' } },
        // No stored length: the projector pins it from the whole body.
        { crawler: 'naive', data: { content: big('no length'), title: 'C' } },
        { crawler: 'naive', data: { content: 'short page', length: 10, title: 'D' } },
        { crawler: 'naive', data: { content: big('err'), errorType: 'Timeout', length: 1 } },
        'not-an-object',
      ],
    },
  },
  // Not reduced by this SQL: untouched.
  {
    apiName: 'search',
    content: big('search body'),
    id: 'search',
    identifier: 'lobe-web-browsing',
    state: { results: [{ title: 'r', url: 'https://example.com' }] },
  },
  {
    apiName: 'runCommand',
    content: big('array state'),
    id: 'run-array-state',
    identifier: 'lobe-local-system',
    state: ['not', 'an', 'object'],
  },
  // One row for EVERY tool the SQL reduces, carrying every key any reduction
  // removes. The projection-equivalence case then fails for any of them whose
  // projector stops dropping what the SQL drops (or disappears).
  ...VIEW_MODEL_REDUCED_TOOLS.map((tool): ToolRow => {
    const [identifier, apiName] = tool.split('/');
    return {
      apiName,
      content: big(`${tool} body`),
      id: `every-${tool.replaceAll('/', '-')}`,
      identifier,
      state: {
        charCount: 5000,
        content: big('content'),
        matches: [big('match')],
        output: big('output'),
        results: [{ data: { content: big('page'), length: 5000, title: 'P' } }],
        stdout: big('stdout'),
        xml: big('xml'),
      },
    };
  }),
];

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(topics).values({ id: topicId, userId });
  await serverDB.insert(messages).values([
    { content: 'hi', createdAt: new Date(2024, 0, 1), id: 'user', role: 'user', topicId, userId },
    ...toolRows.map((row, index) => ({
      content: row.content,
      createdAt: new Date(2024, 0, 1, 0, index + 1),
      id: row.id,
      role: 'tool' as const,
      topicId,
      userId,
    })),
  ]);
  await serverDB.insert(messagePlugins).values(
    toolRows.map((row) => ({
      apiName: row.apiName,
      id: row.id,
      identifier: row.identifier,
      state: row.state as Record<string, unknown>,
      toolCallId: `tc-${row.id}`,
      userId,
    })),
  );
});

afterEach(async () => {
  await serverDB.delete(messageGroups).where(eq(messageGroups.userId, userId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

const stateOf = (list: { id: string; pluginState?: unknown }[], id: string) =>
  list.find((message) => message.id === id)?.pluginState as any;

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

describe('MessageModel.query viewModelPluginState', () => {
  it('projects to exactly what a full read projects to', async () => {
    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    expect(reduced.map((message) => message.id)).toEqual(full.map((message) => message.id));
    expect(projectToolViewModels(reduced)).toEqual(projectToolViewModels(full));
  });

  it('keeps everything outside pluginState and every key the model reads', async () => {
    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    const withoutState = (list: typeof full) =>
      list.map(({ pluginState: _state, ...rest }) => rest);
    expect(withoutState(reduced)).toEqual(withoutState(full));
    expect(stateOf(reduced, 'file').images).toEqual([{ url: 'https://example.com/a.png' }]);
    expect(stateOf(reduced, 'file').path).toBe('/a.ts');
    expect(stateOf(reduced, 'doc')).toEqual({ id: 'docs_1', title: 'Spec' });
  });

  it('drops the projected-away payload keys from the database read', async () => {
    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    expect(stateOf(reduced, 'run')).toEqual({ exitCode: 0, success: true });
    expect(stateOf(reduced, 'codex')).toEqual({ exitCode: 0 });
    expect(stateOf(reduced, 'file')).not.toHaveProperty('content');
    expect(stateOf(reduced, 'grep')).toEqual({ totalMatches: 50 });

    const pages = stateOf(reduced, 'crawl').results;
    expect(pages[0].data.content).toHaveLength(200);
    // 200 code points: 150 two-unit emoji + 50 letters.
    expect(pages[1].data.content).toBe(astralPage.slice(0, 350));
    expect(pages[2].data.content).toBe(big('no length'));
    expect(pages[4].data.content).toBe(big('err'));
    expect(pages[5]).toBe('not-an-object');

    const stateBytes = (list: typeof full) =>
      bytes(
        list
          .filter((message) => !message.id.startsWith('every-'))
          .map((message) => message.pluginState),
      );
    expect(stateBytes(reduced)).toBeLessThan(stateBytes(full) / 2);
  });

  it('leaves rows whose projection depends on the dropped keys whole', async () => {
    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    for (const id of [
      'run-empty-body',
      'run-loading',
      'file-no-count',
      'search',
      'run-array-state',
    ])
      expect(stateOf(reduced, id)).toEqual(stateOf(full, id));
  });

  it('reduces every listed tool while its projection stays the same', async () => {
    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    for (const tool of VIEW_MODEL_REDUCED_TOOLS) {
      const id = `every-${tool.replaceAll('/', '-')}`;
      expect(bytes(stateOf(reduced, id)), tool).toBeLessThan(bytes(stateOf(full, id)));
      expect(projectToolViewModels(reduced.filter((message) => message.id === id)), tool).toEqual(
        projectToolViewModels(full.filter((message) => message.id === id)),
      );
    }
  });

  it('reduces the members a message group hydrates as well', async () => {
    await serverDB.insert(messageGroups).values({
      content: 'Summary',
      createdAt: new Date(2024, 0, 2),
      id: 'vmps-group',
      topicId,
      type: MessageGroupType.Compression,
      userId,
    });
    await serverDB
      .update(messages)
      .set({ messageGroupId: 'vmps-group' })
      .where(eq(messages.topicId, topicId));

    const full = await messageModel.query({ topicId });
    const reduced = await messageModel.query({ topicId, viewModelPluginState: true });

    const membersOf = (list: typeof full) =>
      (list.find((message) => message.role === 'compressedGroup') as any).compressedMessages;
    expect(stateOf(membersOf(full), 'run')).toHaveProperty('stdout');
    expect(stateOf(membersOf(reduced), 'run')).toEqual({ exitCode: 0, success: true });
    expect(projectToolViewModels(reduced)).toEqual(projectToolViewModels(full));
  });
});
