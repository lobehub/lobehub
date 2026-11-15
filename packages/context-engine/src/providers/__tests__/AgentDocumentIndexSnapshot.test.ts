import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages/MessagesEngine';
import { getSlicedMessages } from '../../processors/HistoryTruncate';
import type { UIChatMessage } from '../../types';
import type { AgentContextDocument, AgentDocumentIndexSnapshot } from '../AgentDocumentInjector';
import {
  agentDocumentChangesByMessage,
  agentDocumentsFromSnapshot,
  diffAgentDocumentIndex,
  formatAgentDocumentChanges,
  noteAgentDocumentChanges,
  resolveAgentDocumentIndex,
  takeAgentDocumentIndexSnapshot,
} from '../AgentDocumentInjector';

const REPORT_ID = '2af6eb88-8bdb-468f-887f-620baa394efa';
const NOTES_ID = '32e12975-7db2-4818-8415-9b5c3d383f05';
const PLAN_ID = '9c1f0d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const TTL = 5 * 60 * 1000;

const progressiveDoc = (doc: Partial<AgentContextDocument> & { id: string }) =>
  ({
    filename: `${doc.id}.md`,
    loadPosition: 'before-first-user',
    loadRules: { rule: 'always' },
    policyLoad: 'progressive',
    sourceType: 'agent',
    ...doc,
  }) as AgentContextDocument;

const report = (size = 9_400, updatedAt = '2026-05-01T00:00:00.000Z') =>
  progressiveDoc({ contentCharCount: size, id: REPORT_ID, title: 'Draft report', updatedAt });
const notes = () =>
  progressiveDoc({
    contentCharCount: 13_200,
    id: NOTES_ID,
    title: 'Weekly notes',
    updatedAt: '2026-05-28T00:00:00.000Z',
  });
const plan = () =>
  progressiveDoc({
    contentCharCount: 2_300,
    createdAt: '2026-11-14T10:01:30.000Z',
    id: PLAN_ID,
    title: 'Launch plan',
    updatedAt: '2026-11-14T10:01:30.000Z',
  });

const at = (minute: number, second = 0) =>
  `2026-11-14T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

const user = (id: string, createdAt: string, content = id): UIChatMessage =>
  ({ content, createdAt, id, role: 'user', updatedAt: createdAt }) as UIChatMessage;
const assistant = (id: string, createdAt: string): UIChatMessage =>
  ({
    content: `reply ${id}`,
    createdAt,
    id,
    role: 'assistant',
    updatedAt: createdAt,
  }) as UIChatMessage;

/** What the server host does per step: resolve the snapshot, then run the engine on it. */
const runTurn = async (
  docs: AgentContextDocument[],
  messages: UIChatMessage[],
  stored?: AgentDocumentIndexSnapshot,
  history: { enableHistoryCount?: boolean; historyCount?: number } = {},
) => {
  const { snapshot } = resolveAgentDocumentIndex({
    cacheTtlMs: TTL,
    docs,
    messages,
    now: new Date(messages.at(-1)!.createdAt as unknown as string),
    stored,
    visibleMessages: getSlicedMessages(messages, history),
  });
  const result = await new MessagesEngine({
    agentDocumentChanges: agentDocumentChangesByMessage(snapshot),
    agentDocuments: agentDocumentsFromSnapshot(docs, snapshot),
    enableSystemDate: false,
    ...history,
    messages,
    model: 'claude-sonnet-5-5',
    provider: 'anthropic',
  }).process();
  return { payload: result.messages, snapshot };
};

const turn1 = [user('u1', at(0))];
const turn2 = [...turn1, assistant('a1', at(0, 30)), user('u2', at(2))];
const turn3 = [...turn2, assistant('a2', at(2, 30)), user('u3', at(4))];

describe('agent-document index snapshot', () => {
  // Regression: the index sits at the front of the prompt. A document created,
  // edited or deleted in an earlier turn re-rendered it, so the whole cached
  // conversation behind it was written to the cache again on the next turn.
  it('keeps every earlier message byte-identical while documents change between warm turns', async () => {
    const first = await runTurn([report(), notes()], turn1);
    // Turn 1 created a plan and edited the report.
    const second = await runTurn(
      [report(14_100, at(0, 20)), notes(), plan()],
      turn2,
      first.snapshot,
    );
    // Turn 2 deleted the weekly notes.
    const third = await runTurn([report(14_100, at(0, 20)), plan()], turn3, second.snapshot);

    // Rendered from the live documents, turn 2 rewrites the index at the front.
    const live = await new MessagesEngine({
      agentDocuments: [report(14_100, at(0, 20)), notes(), plan()],
      enableSystemDate: false,
      messages: turn2,
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
    }).process();
    expect(live.messages[0]).not.toEqual(first.payload[0]);

    expect(second.payload.slice(0, first.payload.length)).toEqual(first.payload);
    expect(third.payload.slice(0, second.payload.length)).toEqual(second.payload);

    const index = JSON.stringify(first.payload[0].content);
    expect(index).toContain('9.4k');
    expect(index).not.toContain('Launch plan');

    const lastContent = (payload: typeof first.payload) => payload.at(-1)!.content as string;
    expect(lastContent(second.payload)).toContain('<agent_documents_changes>');
    expect(lastContent(second.payload)).toMatch(/created\s+Launch plan/);
    expect(lastContent(second.payload)).toMatch(/edited\s+Draft report\s+\S+\s+14k/);
    expect(lastContent(second.payload)).toContain('read it again before using it');
    expect(lastContent(third.payload)).toMatch(/deleted\s+Weekly notes/);
    expect(lastContent(third.payload)).toContain('do not read them');
  });

  // Regression: a topic that started with no documents has an empty snapshot,
  // and the notes were switched off with the (empty) index, hiding new documents.
  it('shows documents created after an empty snapshot', async () => {
    const first = await runTurn([], turn1);
    const second = await runTurn([plan()], turn2, first.snapshot);

    expect(second.payload.at(-1)!.content as string).toMatch(/created\s+Launch plan/);
  });

  // Regression: with history limited, the message carrying the earlier note is
  // cut before the engine runs, so suppressing an identical note left the model
  // with neither the snapshot row nor a note for the new document.
  it('notes the difference again when history truncation drops the earlier note', async () => {
    const history = { enableHistoryCount: true, historyCount: 1 };
    const first = await runTurn([], turn1, undefined, history);
    const second = await runTurn([plan()], turn2, first.snapshot, history);
    const third = await runTurn([plan()], turn3, second.snapshot, history);

    expect(JSON.stringify(third.payload)).not.toContain('"u2"');
    expect(third.payload.at(-1)!.content as string).toMatch(/created\s+Launch plan/);
  });

  it('refreshes the index and drops the notes once the cache has gone cold', async () => {
    const first = await runTurn([report(), notes()], turn1);
    const second = await runTurn([report(), notes(), plan()], turn2, first.snapshot);
    const coldTurn = [...turn2, assistant('a2', at(2, 30)), user('u3', at(30))];

    const third = await runTurn([report(), notes(), plan()], coldTurn, second.snapshot);

    expect(third.snapshot.notes).toEqual([]);
    expect(JSON.stringify(third.payload[0].content)).toContain('Launch plan');
    expect(JSON.stringify(third.payload)).not.toContain('agent_documents_changes');
  });

  it('refreshes the index after the history is compressed', () => {
    const stored = takeAgentDocumentIndexSnapshot([report()], { takenAt: new Date(at(0)) });
    const compressed = [
      { createdAt: at(1), id: 'compressed-1', role: 'compressedGroup' },
      user('u2', at(2)),
    ];

    const { snapshot } = resolveAgentDocumentIndex({
      cacheTtlMs: TTL,
      docs: [report(), plan()],
      messages: compressed,
      now: new Date(at(2)),
      stored,
    });

    expect(snapshot.compressionId).toBe('compressed-1');
    expect(snapshot.rows.map((row) => row.id)).toEqual([REPORT_ID, PLAN_ID]);
  });

  it('reuses the pinned snapshot on later steps of the run, whatever the documents do', () => {
    const pinned = takeAgentDocumentIndexSnapshot([report()], { takenAt: new Date(at(0)) });

    const resolved = resolveAgentDocumentIndex({
      cacheTtlMs: TTL,
      docs: [report(14_100, at(0, 20)), plan()],
      messages: [...turn1, assistant('a1', at(0, 30))],
      now: new Date(at(0, 40)),
      pinned,
    });

    expect(resolved).toEqual({ pin: false, snapshot: pinned, store: false });
  });

  it('takes a fresh snapshot over a pinned value of the earlier per-run format', () => {
    const { pin, snapshot } = resolveAgentDocumentIndex({
      cacheTtlMs: TTL,
      docs: [report()],
      messages: turn1,
      now: new Date(at(0)),
      pinned: { [REPORT_ID]: { contentCharCount: 9_400 } },
    });

    expect(pin).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
  });

  it('renders deleted documents from their snapshot row and hides newer ones', () => {
    const snapshot = takeAgentDocumentIndexSnapshot([report(), notes()], {
      takenAt: new Date(at(0)),
    });
    const inline = progressiveDoc({ content: 'rules', id: 'rules', policyLoad: 'always' });

    const docs = agentDocumentsFromSnapshot([inline, report(14_100, at(0, 20)), plan()], snapshot);

    expect(docs[0]).toBe(inline);
    expect(docs.slice(1).map((doc) => [doc.id, doc.contentCharCount])).toEqual([
      [REPORT_ID, 9_400],
      [NOTES_ID, 13_200],
    ]);
    expect(docs.some((doc) => doc.createdAt)).toBe(false);
  });
});

describe('noteAgentDocumentChanges', () => {
  const snapshot = () => takeAgentDocumentIndexSnapshot([report()], { takenAt: new Date(at(0)) });
  const present = (...ids: string[]) => new Set(ids);

  it('keeps the note a message already has', () => {
    const noted = noteAgentDocumentChanges(snapshot(), [report(), plan()], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    const again = noteAgentDocumentChanges(noted, [report(14_100, at(3))], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    expect(again).toBe(noted);
  });

  it('adds nothing when nothing changed or the newest present note already says it', () => {
    const base = snapshot();
    expect(
      noteAgentDocumentChanges(base, [report()], { messageId: 'u2', presentMessageIds: present() }),
    ).toBe(base);

    const noted = noteAgentDocumentChanges(base, [report(), plan()], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });
    expect(
      noteAgentDocumentChanges(noted, [report(), plan()], {
        messageId: 'u3',
        presentMessageIds: present('u2', 'u3'),
      }),
    ).toBe(noted);
  });

  // Regression: the snapshot rows never had a document created after it, so
  // deleting that document produced no note and the earlier "created" stood.
  it('reports a deletion of a document an earlier note reported as created', () => {
    const noted = noteAgentDocumentChanges(snapshot(), [report(), plan()], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    const next = noteAgentDocumentChanges(noted, [report()], {
      messageId: 'u3',
      presentMessageIds: present('u2', 'u3'),
    });

    expect(next.notes.at(-1)).toEqual({
      changes: [{ id: PLAN_ID, kind: 'deleted', title: 'Launch plan' }],
      messageId: 'u3',
    });
  });

  // Regression: a move keeps the timestamp and size, so a folded folder in the
  // index kept pointing the model at the old parent with no note.
  it('reports a document moved to another folder', () => {
    const inFolder = (parentId: string, folderTitle: string) =>
      progressiveDoc({ ...report(), folderTitle, parentId });
    const base = takeAgentDocumentIndexSnapshot([inFolder('f1', 'Drafts')], {
      takenAt: new Date(at(0)),
    });

    const next = noteAgentDocumentChanges(base, [inFolder('f2', 'Final')], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    expect(next.notes.at(-1)!.changes).toMatchObject([
      { folderTitle: 'Final', id: REPORT_ID, kind: 'edited' },
    ]);
  });

  // Regression: renaming back to the snapshot title left an empty diff, so the
  // earlier note — which overrides the index — kept the intermediate title.
  it('corrects an earlier edit note once the document matches its snapshot again', () => {
    const renamed = progressiveDoc({ ...report(), title: 'Interim report' });
    const noted = noteAgentDocumentChanges(snapshot(), [renamed], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    const next = noteAgentDocumentChanges(noted, [report()], {
      messageId: 'u3',
      presentMessageIds: present('u2', 'u3'),
    });

    expect(next.notes.at(-1)).toEqual({
      changes: [expect.objectContaining({ id: REPORT_ID, kind: 'edited', title: 'Draft report' })],
      messageId: 'u3',
    });
  });

  it('repeats the difference when the message carrying it is gone', () => {
    const noted = noteAgentDocumentChanges(snapshot(), [report(), plan()], {
      messageId: 'u2',
      presentMessageIds: present('u2'),
    });

    const next = noteAgentDocumentChanges(noted, [report(), plan()], {
      messageId: 'u3',
      presentMessageIds: present('u3'),
    });

    expect(next.notes.map((note) => note.messageId)).toEqual(['u2', 'u3']);
  });
});

describe('diffAgentDocumentIndex', () => {
  it('ignores web-crawled documents, which the index does not list', () => {
    const web = progressiveDoc({ contentCharCount: 10, id: 'web-1', sourceType: 'web' });
    const { rows } = takeAgentDocumentIndexSnapshot([report()], { takenAt: new Date(at(0)) });

    expect(diffAgentDocumentIndex(rows, [report(), web])).toEqual([]);
  });

  it('formats changes in the index columns', () => {
    expect(
      formatAgentDocumentChanges([
        {
          contentCharCount: 2_300,
          folderTitle: 'Plans',
          id: PLAN_ID,
          kind: 'created',
          title: 'Launch plan',
          updatedAt: '2026-11-14T10:01:30.000Z',
        },
        { id: NOTES_ID, kind: 'deleted', title: 'Weekly notes' },
      ]),
    ).toMatchInlineSnapshot(`
      "Agent documents changed since <agent_documents_index> was listed. The index is not refreshed; for these documents this table is current, and deleted ones no longer exist — do not read them.

      CHANGE   TITLE                   ID                                    SIZE  UPDATED
      created  Launch plan (in Plans)  9c1f0d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f  2.3k  2026-11-14
      deleted  Weekly notes            32e12975-7db2-4818-8415-9b5c3d383f05  —     —"
    `);
  });
});
