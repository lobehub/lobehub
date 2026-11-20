import { describe, expect, it } from 'vitest';

import { type KnowledgeItem, KnowledgeType } from '@/types/knowledgeBase';

import { filterPickerItems, itemsOfKind, type PickerSort } from './filterPickerItems';

const file = (id: string, fileType: string, extra?: Partial<KnowledgeItem>): KnowledgeItem => ({
  fileType,
  id,
  name: id,
  type: KnowledgeType.File,
  ...extra,
});
const library = (id: string, extra?: Partial<KnowledgeItem>): KnowledgeItem => ({
  id,
  name: id,
  type: KnowledgeType.KnowledgeBase,
  ...extra,
});

// The server returns every file first and libraries last, so a member with many uploads opened
// "Add library" and saw only video files.
const items = [
  file('line-plan-it-r1-4k.mp4', 'video/mp4'),
  file('podcast.mp3', 'audio/mpeg'),
  file('handbook.pdf', 'application/pdf'),
  file('notes.md', 'text/markdown', { enabled: true }),
  library('Product docs'),
  library('Support FAQ', { enabled: true }),
];

const files = [
  file('b-old.pdf', 'application/pdf', { createdAt: '2025-06-01', updatedAt: '2026-01-01' }),
  file('a-new.pdf', 'application/pdf', { createdAt: '2025-01-01', updatedAt: '2026-03-01' }),
  file('c-mid.pdf', 'application/pdf', { createdAt: '2025-12-01', updatedAt: '2026-02-01' }),
];

const ids = (sort: PickerSort, list = files) =>
  filterPickerItems({ items: list, kind: 'file', sort }).map((item) => item.id);

describe('filterPickerItems', () => {
  it('shows only libraries in the library tab', () => {
    expect(filterPickerItems({ items, kind: 'library' }).map((item) => item.id)).toEqual([
      'Support FAQ',
      'Product docs',
    ]);
  });

  it('shows only searchable files in the file tab, attached first', () => {
    expect(filterPickerItems({ items, kind: 'file' }).map((item) => item.id)).toEqual([
      'notes.md',
      'handbook.pdf',
    ]);
  });

  it('matches the keyword case-insensitively within the tab', () => {
    expect(filterPickerItems({ items, keyword: ' PRODUCT ', kind: 'library' })).toEqual([
      library('Product docs'),
    ]);
    expect(filterPickerItems({ items, keyword: 'product', kind: 'file' })).toEqual([]);
  });
});

describe('filterPickerItems sort', () => {
  it('lists the most recently updated first by default', () => {
    expect(filterPickerItems({ items: files, kind: 'file' }).map((item) => item.id)).toEqual([
      'a-new.pdf',
      'c-mid.pdf',
      'b-old.pdf',
    ]);
  });

  it('lists the most recently created first', () => {
    expect(ids('createdAt')).toEqual(['c-mid.pdf', 'b-old.pdf', 'a-new.pdf']);
  });

  it('lists by name A–Z and Z–A', () => {
    expect(ids('name')).toEqual(['a-new.pdf', 'b-old.pdf', 'c-mid.pdf']);
    expect(ids('nameDesc')).toEqual(['c-mid.pdf', 'b-old.pdf', 'a-new.pdf']);
  });

  // Reviewers read "A–Z" by first letter: 产品 (chanpin) belongs between API and release.
  it('files Chinese names under their pinyin initial', () => {
    const mixed = [
      file('release-notes.md', 'text/markdown'),
      file('产品需求文档.pdf', 'application/pdf'),
      file('API 接口说明.pdf', 'application/pdf'),
    ];
    expect(ids('name', mixed)).toEqual([
      'API 接口说明.pdf',
      '产品需求文档.pdf',
      'release-notes.md',
    ]);
  });
});

describe('itemsOfKind', () => {
  it('keeps an already attached media file so it can still be removed', () => {
    const attachedVideo = file('demo.mp4', 'video/mp4', { enabled: true });
    expect(itemsOfKind([...items, attachedVideo], 'file').map((item) => item.id)).toContain(
      'demo.mp4',
    );
  });

  it('counts what each tab can offer', () => {
    expect(itemsOfKind(items, 'library')).toHaveLength(2);
    expect(itemsOfKind(items, 'file')).toHaveLength(2);
  });
});
