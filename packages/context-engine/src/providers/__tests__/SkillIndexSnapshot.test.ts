import { describe, expect, it } from 'vitest';

import { MessagesEngine } from '../../engine/messages/MessagesEngine';
import { getSlicedMessages } from '../../processors/HistoryTruncate';
import type { UIChatMessage } from '../../types';
import type { SkillMeta } from '../SkillContextProvider';
import {
  diffSkillIndex,
  formatSkillChanges,
  noteSkillChanges,
  resolveSkillIndex,
  reusablePinnedSkillIndex,
  skillChangesByMessage,
  type SkillIndexSnapshot,
  skillsFromSnapshot,
  takeSkillIndexSnapshot,
} from '../SkillIndexSnapshot';

const TTL = 5 * 60 * 1000;

const docWriter = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
  description: 'Drafts and edits technical documentation.',
  identifier: 'doc-writer',
  name: 'doc-writer',
  ...overrides,
});

const chartMaker = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
  description: 'Builds SVG charts from tabular data.',
  identifier: 'chart-maker',
  name: 'chart-maker',
  ...overrides,
});

const memoSkill = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
  description: 'Formats executive decision memos with required risk tables.',
  identifier: 'url-opaque-memo',
  name: 'q4-helper',
  ...overrides,
});

const at = (minute: number, second = 0) =>
  `2026-11-25T10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

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

/** Mirrors what the server host does per turn: resolve snapshot, then run MessagesEngine. */
const runTurn = async (
  skills: SkillMeta[],
  messages: UIChatMessage[],
  stored?: SkillIndexSnapshot,
  history: { enableHistoryCount?: boolean; historyCount?: number } = {},
) => {
  const { snapshot } = resolveSkillIndex({
    cacheTtlMs: TTL,
    messages,
    now: new Date(messages.at(-1)!.createdAt as unknown as string),
    skills,
    stored,
    visibleMessages: getSlicedMessages(messages, history),
  });
  const effectiveSkills = skillsFromSnapshot(skills, snapshot);
  const result = await new MessagesEngine({
    enableAgentMode: true,
    enableSystemDate: false,
    ...history,
    messages,
    model: 'claude-haiku-4-5',
    provider: 'anthropic',
    skillChanges: skillChangesByMessage(snapshot),
    ...(effectiveSkills.length > 0 && { skillsConfig: { enabledSkills: effectiveSkills } }),
    systemRole: 'You are a helpful assistant.',
  }).process();
  return { payload: result.messages, snapshot };
};

const turn1 = [user('u1', at(0), 'Install the skill from URL')];
const turn2 = [...turn1, assistant('a1', at(0, 30)), user('u2', at(2), 'What is 2+2?')];
const turn3 = [
  ...turn2,
  assistant('a2', at(2, 30)),
  user('u3', at(4), 'Write an executive decision memo'),
];

describe('SkillIndexSnapshot', () => {
  it('preserves byte-identical prefix on 0 -> 1 skill install and surfaces the new skill description + activateSkill cue', async () => {
    // Turn 1 starts with 0 skills: snapshot captures empty rows.
    const first = await runTurn([], turn1);
    expect(first.payload[0].content).not.toContain('<available_skills>');

    // Turn 2 (warm cache): skill installed via URL; msg[0] must NOT change,
    // while u2 carries <skills_changes> with full description & activateSkill cue.
    const second = await runTurn([memoSkill()], turn2, first.snapshot);
    expect(second.payload.slice(0, first.payload.length)).toEqual(first.payload);
    expect(second.payload[0].content).not.toContain('<available_skills>');
    const u2Content = second.payload.at(-1)!.content as string;
    expect(u2Content).toContain('<skills_changes>');
    expect(u2Content).toContain('Use the activateSkill tool');
    expect(u2Content).toContain(
      '<skill name="q4-helper">Formats executive decision memos with required risk tables.</skill>',
    );

    // Turn 3 (warm cache, no new skill change): u2 replays verbatim, u3 gets no duplicate note.
    const third = await runTurn([memoSkill()], turn3, second.snapshot);
    expect(third.payload.slice(0, second.payload.length)).toEqual(second.payload);
    expect(third.payload.at(-1)!.content as string).not.toContain('<skills_changes>');
  });

  it('keeps every earlier message byte-identical while skills are added, updated, and removed across warm turns', async () => {
    const first = await runTurn([docWriter(), chartMaker()], turn1);

    // Turn 2: memoSkill prepended first (updatedAt DESC) + docWriter description edited.
    const editedDocWriter = docWriter({ description: 'Writes RFCs and design docs.' });
    const second = await runTurn(
      [memoSkill(), editedDocWriter, chartMaker()],
      turn2,
      first.snapshot,
    );

    // Without snapshot, Turn 2 rewrites msg[0].
    const live = await new MessagesEngine({
      enableAgentMode: true,
      enableSystemDate: false,
      messages: turn2,
      model: 'claude-haiku-4-5',
      provider: 'anthropic',
      skillsConfig: { enabledSkills: [memoSkill(), editedDocWriter, chartMaker()] },
      systemRole: 'You are a helpful assistant.',
    }).process();
    expect(live.messages[0]).not.toEqual(first.payload[0]);

    // With snapshot, every message from Turn 1 stays byte-identical.
    expect(second.payload.slice(0, first.payload.length)).toEqual(first.payload);
    const u2Content = second.payload.at(-1)!.content as string;
    expect(u2Content).toContain('<added_skills>');
    expect(u2Content).toContain('<skill name="q4-helper">');
    expect(u2Content).toContain('<updated_skills>');
    expect(u2Content).toContain('<skill name="doc-writer">Writes RFCs and design docs.</skill>');

    // Turn 3: chartMaker removed + memoSkill (previously added via note) also removed.
    const third = await runTurn([editedDocWriter], turn3, second.snapshot);
    expect(third.payload.slice(0, second.payload.length)).toEqual(second.payload);
    const u3Content = third.payload.at(-1)!.content as string;
    expect(u3Content).toContain('<removed_skills>');
    expect(u3Content).toContain('<skill name="chart-maker" />');
    expect(u3Content).toContain('<skill name="q4-helper" />');
  });

  it('emits no diff and preserves msg[0] when DB only reorders skills (updatedAt DESC)', async () => {
    const first = await runTurn([docWriter(), chartMaker()], turn1);
    const second = await runTurn([chartMaker(), docWriter()], turn2, first.snapshot);

    expect(second.payload.slice(0, first.payload.length)).toEqual(first.payload);
    expect(second.snapshot.notes).toHaveLength(0);
    expect(second.payload.at(-1)!.content as string).not.toContain('<skills_changes>');
  });

  it('refreshes the snapshot and drops old notes after a cold cache gap (> TTL)', async () => {
    const first = await runTurn([docWriter()], turn1);
    const warm = await runTurn([memoSkill(), docWriter()], turn2, first.snapshot);
    expect(warm.snapshot.notes).toHaveLength(1);

    // 10 minutes later (> 5m TTL): cache is cold, refresh snapshot for free.
    const coldTurn = [
      ...turn2,
      assistant('a2', at(2, 30)),
      user('u3', at(12, 30), 'Back after a break'),
    ];
    const refreshed = await runTurn([memoSkill(), docWriter()], coldTurn, warm.snapshot);

    expect(refreshed.snapshot.notes).toHaveLength(0);
    expect(refreshed.payload[0].content).toContain('<skill name="q4-helper">');
    expect(refreshed.payload.at(-1)!.content as string).not.toContain('<skills_changes>');
  });

  it('refreshes the snapshot when a new compressedGroup appears', () => {
    const pinned = takeSkillIndexSnapshot([docWriter()], { takenAt: new Date(at(0)) });
    const compressedMessages = [
      { content: 'summary', createdAt: at(1), id: 'cg1', role: 'compressedGroup' },
      user('u2', at(2)),
    ];

    expect(reusablePinnedSkillIndex({ messages: compressedMessages, pinned })).toBeUndefined();

    const resolved = resolveSkillIndex({
      cacheTtlMs: TTL,
      messages: compressedMessages,
      now: new Date(at(2)),
      pinned,
      skills: [memoSkill(), docWriter()],
    });

    expect(resolved.pin).toBe(true);
    expect(resolved.store).toBe(true);
    expect(resolved.snapshot.compressionId).toBe('cg1');
    expect(resolved.snapshot.rows.map((r) => r.identifier)).toEqual([
      'url-opaque-memo',
      'doc-writer',
    ]);
  });

  it('reuses a pinned snapshot mid-run without re-diffing or storing', () => {
    const pinned = takeSkillIndexSnapshot([docWriter()], { takenAt: new Date(at(0)) });
    const resolved = resolveSkillIndex({
      cacheTtlMs: TTL,
      messages: turn2,
      now: new Date(at(2)),
      pinned,
      skills: [memoSkill(), docWriter()],
    });

    expect(resolved).toEqual({ pin: false, snapshot: pinned, store: false });
  });

  it('re-emits the change note when history truncation drops the earlier user message carrying it', async () => {
    const first = await runTurn([docWriter()], turn1, undefined, {
      enableHistoryCount: true,
      historyCount: 2,
    });
    const second = await runTurn([memoSkill(), docWriter()], turn2, first.snapshot, {
      enableHistoryCount: true,
      historyCount: 2,
    });
    expect(second.snapshot.notes.map((n) => n.messageId)).toEqual(['u2']);

    // Turn 3 keeps only [a2, u3] — u2 is truncated out, so u3 must receive the note again.
    const third = await runTurn([memoSkill(), docWriter()], turn3, second.snapshot, {
      enableHistoryCount: true,
      historyCount: 2,
    });
    expect(third.snapshot.notes.map((n) => n.messageId)).toEqual(['u2', 'u3']);
    expect(third.payload.at(-1)!.content as string).toContain('<skill name="q4-helper">');
  });

  it('notes when a previously edited skill reverts to its snapshot description', () => {
    const base = takeSkillIndexSnapshot([docWriter()], { takenAt: new Date(at(0)) });
    const edited = noteSkillChanges(base, [docWriter({ description: 'Edited desc' })], {
      messageId: 'u2',
      presentMessageIds: new Set(['u1', 'u2']),
    });
    const reverted = noteSkillChanges(edited, [docWriter()], {
      messageId: 'u3',
      presentMessageIds: new Set(['u1', 'u2', 'u3']),
    });

    expect(reverted.notes).toHaveLength(2);
    expect(reverted.notes[1]).toEqual({
      changes: [
        {
          description: 'Drafts and edits technical documentation.',
          identifier: 'doc-writer',
          kind: 'updated',
          name: 'doc-writer',
        },
      ],
      messageId: 'u3',
    });
  });

  it('notes when a skill removed on an earlier turn is re-enabled unchanged', () => {
    const base = takeSkillIndexSnapshot([docWriter(), chartMaker()], { takenAt: new Date(at(0)) });
    const disabled = noteSkillChanges(base, [chartMaker()], {
      messageId: 'u2',
      presentMessageIds: new Set(['u1', 'u2']),
    });
    expect(disabled.notes[0].changes).toEqual([
      { identifier: 'doc-writer', kind: 'removed', name: 'doc-writer' },
    ]);

    const restored = noteSkillChanges(disabled, [docWriter(), chartMaker()], {
      messageId: 'u3',
      presentMessageIds: new Set(['u1', 'u2', 'u3']),
    });

    expect(restored.notes).toHaveLength(2);
    expect(restored.notes[1]).toEqual({
      changes: [
        {
          description: 'Drafts and edits technical documentation.',
          identifier: 'doc-writer',
          kind: 'updated',
          name: 'doc-writer',
        },
      ],
      messageId: 'u3',
    });

    const rendered = formatSkillChanges(restored.notes[1].changes);
    expect(rendered).toContain('<skill name="doc-writer">');
    expect(rendered).not.toContain('<removed_skills>');

    // The correction already says it: a later unchanged turn adds nothing.
    const later = noteSkillChanges(restored, [docWriter(), chartMaker()], {
      messageId: 'u4',
      presentMessageIds: new Set(['u1', 'u2', 'u3', 'u4']),
    });
    expect(later).toBe(restored);
  });

  it('revokes every advertised name when a skill renamed on an earlier turn is removed', () => {
    const base = takeSkillIndexSnapshot([docWriter(), chartMaker()], { takenAt: new Date(at(0)) });
    const renamed = noteSkillChanges(base, [docWriter({ name: 'doc-author' }), chartMaker()], {
      messageId: 'u2',
      presentMessageIds: new Set(['u1', 'u2']),
    });
    expect(renamed.notes[0].changes).toMatchObject([{ kind: 'updated', name: 'doc-author' }]);

    const removed = noteSkillChanges(renamed, [chartMaker()], {
      messageId: 'u3',
      presentMessageIds: new Set(['u1', 'u2', 'u3']),
    });

    expect(removed.notes).toHaveLength(2);
    expect(removed.notes[1].changes).toEqual([
      { identifier: 'doc-writer', kind: 'removed', name: 'doc-writer' },
      { identifier: 'doc-writer', kind: 'removed', name: 'doc-author' },
    ]);

    const rendered = formatSkillChanges(removed.notes[1].changes);
    expect(rendered).toContain('<skill name="doc-writer" />');
    expect(rendered).toContain('<skill name="doc-author" />');
  });

  it('keeps live pre-activated skills without duplicating them or marking them removed', () => {
    const base = takeSkillIndexSnapshot([docWriter(), chartMaker()], { takenAt: new Date(at(0)) });
    const live: SkillMeta[] = [
      docWriter({ activated: true, content: '# Full doc-writer instructions' }),
      chartMaker(),
    ];

    expect(diffSkillIndex(base.rows, live)).toEqual([]);
    const combined = skillsFromSnapshot(live, base);
    expect(combined.filter((s) => s.identifier === 'doc-writer')).toHaveLength(1);
    expect(combined.find((s) => s.identifier === 'doc-writer')?.activated).toBe(true);
  });

  it('formats filesystem skill hints based on canActivateSkill', () => {
    const projectSkillChange = {
      description: 'Repo-local linter',
      identifier: 'project:lint',
      kind: 'added' as const,
      location: '/repo/.agents/skills/lint/SKILL.md',
      name: 'lint',
      source: 'project' as const,
    };

    const withActivate = formatSkillChanges([projectSkillChange], { canActivateSkill: true });
    expect(withActivate).toContain('do not bypass activation with readFile');
    expect(withActivate).toContain('source="project"');
    expect(withActivate).toContain('location="/repo/.agents/skills/lint/SKILL.md"');

    const withoutActivate = formatSkillChanges([projectSkillChange], { canActivateSkill: false });
    expect(withoutActivate).toContain('calling the readFile tool on its `location` path');
  });
});
