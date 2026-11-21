import { describe, expect, it } from 'vitest';

import { type ChatTopic } from '@/types/topic';

import {
  directorySectionTag,
  directorySectionTitle,
  groupTopicsByDirectory,
  NO_DIRECTORY_SECTION_ID,
  sectionsDeviceGroupByDirectory,
} from './directorySections';

const topic = (id: string, extra: Partial<ChatTopic> = {}) =>
  ({ id, title: id, ...extra }) as ChatTopic;

const labels = { noDirectory: 'No directory', unknownDirectory: 'Unknown directory' };

describe('groupTopicsByDirectory', () => {
  it('sections topics by project directory, then folder path, with directory-less topics last', () => {
    const sections = groupTopicsByDirectory([
      topic('loose'),
      topic('a1', { projectWorkingDirectoryId: 'dir-a' }),
      topic('p1', { metadata: { workingDirectory: '/tmp/scratch' } } as Partial<ChatTopic>),
      topic('a2', { projectWorkingDirectoryId: 'dir-a' }),
    ]);

    expect(sections?.map((section) => [section.id, section.children.map((t) => t.id)])).toEqual([
      ['directory:dir-a', ['a1', 'a2']],
      ['path:/tmp/scratch', ['p1']],
      [NO_DIRECTORY_SECTION_ID, ['loose']],
    ]);
  });
});

describe('groupTopicsByDirectory without directories', () => {
  /** @example a device with only directory-less topics must not nest them under a lone "No directory". */
  it('returns undefined so the device lists its topics flat', () => {
    expect(groupTopicsByDirectory([topic('a'), topic('b')])).toBeUndefined();
  });
});

describe('directorySectionTitle', () => {
  const directories = [
    { id: 'dir-a', name: 'lobehub', path: '/Users/me/lobehub', projectName: 'LobeHub' },
  ];

  it('names a project directory by its project and a bare folder by its last segment', () => {
    const [project, folder] = groupTopicsByDirectory([
      topic('a', { projectWorkingDirectoryId: 'dir-a' }),
      topic('p', { metadata: { workingDirectory: '/tmp/scratch/' } } as Partial<ChatTopic>),
    ])!;

    expect(directorySectionTitle(project, directories, labels)).toBe('LobeHub');
    expect(directorySectionTitle(folder, directories, labels)).toBe('scratch');
  });

  /** @example a directory the registry no longer lists must not render an empty title. */
  it('falls back to the folder, then the unknown label, for an unlisted directory', () => {
    const [withPath, withoutPath] = groupTopicsByDirectory([
      topic('a', {
        metadata: { workingDirectory: '/srv/app' },
        projectWorkingDirectoryId: 'gone-1',
      } as Partial<ChatTopic>),
      topic('b', { projectWorkingDirectoryId: 'gone-2' }),
    ])!;

    expect(directorySectionTitle(withPath, directories, labels)).toBe('app');
    expect(directorySectionTitle(withoutPath, directories, labels)).toBe('Unknown directory');
    expect(directorySectionTag(withoutPath, directories)).toBeUndefined();
  });

  it('labels the directory-less section', () => {
    const [, loose] = groupTopicsByDirectory([
      topic('a', { projectWorkingDirectoryId: 'dir-a' }),
      topic('loose'),
    ])!;
    expect(directorySectionTitle(loose, directories, labels)).toBe('No directory');
  });
});

describe('sectionsDeviceGroupByDirectory', () => {
  /** @example by device in an agent sidebar: the device leads, its directories nest below it. */
  it.each(['device:device-1', 'no-device'])('nests %s by directory in an agent sidebar', (id) => {
    expect(sectionsDeviceGroupByDirectory(id, false)).toBe(true);
  });

  it('keeps project-scoped device groups and synthetic buckets flat', () => {
    expect(sectionsDeviceGroupByDirectory('device:device-1', true)).toBe(false);
    expect(sectionsDeviceGroupByDirectory('favorite', false)).toBe(false);
  });
});
