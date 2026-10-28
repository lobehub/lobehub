import { describe, expect, it } from 'vitest';

import { hasStatusLabel, kindOfType, statusOfValue } from './kinds';
import { hubNamesOf, linkByNames, mentionsOf } from './link';
import { type MemoryActivity, type MemoryEntity } from './types';

const entity = (id: string, names: string[], title = id): MemoryEntity => ({
  capturedAt: '2026-10-01T00:00:00.000Z',
  description: '',
  id,
  kind: 'project',
  names: names.map((name) => ({ name })),
  status: 'active',
  summary: '',
  tags: [],
  title,
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const activity = (id: string, names: string[], when = '2026-10-02T00:00:00.000Z'): MemoryActivity => ({
  id,
  names: names.map((name) => ({ name })),
  narrative: id,
  planned: false,
  title: id,
  when,
  whenIsExact: true,
});

describe('kindOfType', () => {
  it('folds the long tail of free-text types onto the five kinds', () => {
    expect(kindOfType('project')).toBe('project');
    expect(kindOfType('Creative Project')).toBe('project');
    expect(kindOfType('people')).toBe('relationship');
    expect(kindOfType('trip')).toBe('event');
    expect(kindOfType('goal')).toBe('goal');
    expect(kindOfType('phenomenon')).toBe('other');
    expect(kindOfType(null)).toBe('other');
  });
});

describe('statusOfValue', () => {
  it('collapses backend statuses into the list groups', () => {
    expect(statusOfValue('ongoing')).toBe('active');
    expect(statusOfValue('planned')).toBe('active');
    expect(statusOfValue('on_hold')).toBe('dormant');
    expect(statusOfValue('completed')).toBe('closed');
    expect(statusOfValue('cancelled')).toBe('closed');
    expect(statusOfValue(undefined)).toBe('active');
  });

  it('gives the legacy `active` value a translated label instead of showing it raw', () => {
    expect(hasStatusLabel('active')).toBe(true);
    expect(hasStatusLabel('on_hold')).toBe(true);
    expect(hasStatusLabel('something-new')).toBe(false);
  });
});

describe('linkByNames', () => {
  it('links an activity to the contexts that mention the same name, case-insensitively', () => {
    const links = linkByNames(
      [entity('ielts', ['陈老师', 'IELTS']), entity('kb', ['老王'])],
      [activity('mock-exam', ['ielts']), activity('weekly', ['老王'])],
    );

    expect(links.activities.get('ielts')?.map((e) => e.activity.id)).toEqual(['mock-exam']);
    expect(links.activities.get('ielts')?.[0].names).toEqual(['ielts']);
    expect(links.activities.get('kb')?.map((e) => e.activity.id)).toEqual(['weekly']);
  });

  it('matches an activity name against a context title', () => {
    const links = linkByNames([entity('c1', [], '雅思备考')], [activity('a1', ['雅思备考'])]);
    expect(links.activities.get('c1')?.map((e) => e.activity.id)).toEqual(['a1']);
  });

  it('ignores names that appear in most contexts, such as the user themselves', () => {
    const entities = [
      entity('a', ['Arvin', 'IELTS']),
      entity('b', ['Arvin', 'migration']),
      entity('c', ['Arvin', 'camera']),
      entity('d', ['Arvin']),
    ];
    expect(hubNamesOf(mentionsOf(entities, []))).toEqual(new Set(['arvin']));

    const links = linkByNames(entities, [activity('x', ['Arvin'])]);
    expect(links.activities.size).toBe(0);
    expect(links.contexts.get('a')).toEqual([]);
    expect(links.mentions.get('a')).not.toContain('Arvin');
  });

  it('finds activity names inside a context text when the context sends no names', () => {
    const ctx: MemoryEntity = {
      ...entity('cust', [], '中信已打入、三九未打入'),
      description: '计划用 CLI 作为切入点',
    };
    const links = linkByNames(
      [ctx, entity('other', [], '别的事')],
      [activity('visit', ['三九', 'CLI']), activity('noise', ['A'])],
    );

    expect(links.activities.get('cust')?.[0].names).toEqual(['三九', 'CLI']);
    // Single-character names are too noisy to match inside text.
    expect(links.mentions.get('cust')).not.toContain('A');
  });

  it('never links pages through role words such as Assistant or 用户', () => {
    const ctx: MemoryEntity = {
      ...entity('model', ['用户'], 'Training a model'),
      description: 'Raised when the assistant questioned the framing',
    };
    const links = linkByNames(
      [ctx, entity('x', []), entity('y', []), entity('z', [])],
      [activity('sidebar', ['Assistant', '用户'])],
    );

    expect(links.activities.size).toBe(0);
  });

  it('matches Latin names as whole words only', () => {
    const ctx: MemoryEntity = {
      ...entity('citic', [], '算力平台'),
      description: 'deliver training on the all-in-one machine; MacBook later',
    };
    const links = linkByNames(
      [ctx, entity('x', []), entity('y', []), entity('z', [])],
      [activity('apple-music', ['Mac']), activity('laptop', ['MacBook'])],
    );

    expect(links.activities.get('citic')?.map((e) => e.activity.id)).toEqual(['laptop']);
  });

  it('only takes Latin names from text when they read as proper nouns', () => {
    const ctx: MemoryEntity = {
      ...entity('skills', [], '外部数据生成 skills'),
      description: '评估把 Klavis 换成 Composio，同时整理 workspace 里的 git 配置',
    };
    const links = linkByNames(
      [ctx, entity('x', []), entity('y', []), entity('z', [])],
      [activity('swap', ['Composio']), activity('ws', ['workspace']), activity('g', ['git'])],
    );

    expect(links.activities.get('skills')?.map((e) => e.activity.id)).toEqual(['swap']);
  });

  it('relates contexts that share a name and orders each timeline newest first', () => {
    const links = linkByNames(
      [entity('wedding', ['林夏', '相机']), entity('camera', ['相机'])],
      [
        activity('old', ['相机'], '2026-01-01T00:00:00.000Z'),
        activity('new', ['相机'], '2026-09-01T00:00:00.000Z'),
      ],
    );

    expect(links.contexts.get('wedding')).toEqual([{ names: ['相机'], targetId: 'camera' }]);
    expect(links.activities.get('camera')?.map((e) => e.activity.id)).toEqual(['new', 'old']);
  });
});
