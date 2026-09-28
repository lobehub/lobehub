import { describe, expect, it } from 'vitest';

import { localFileKeys } from '@/libs/swr/keys';

import { matchLocalFilePreviewKey } from './previewKeyMatcher';

const tab = { filePath: '/repo/src/a.ts', workingDirectory: '/repo' };

describe('matchLocalFilePreviewKey', () => {
  it('matches every preview variant the body may key for the tab', () => {
    const match = matchLocalFilePreviewKey(tab);

    expect(match(localFileKeys.preview(tab))).toBe(true);
    expect(match(localFileKeys.preview({ ...tab, accept: 'image' }))).toBe(true);
    expect(match(localFileKeys.preview({ ...tab, allowExternalFile: true }))).toBe(true);
    expect(match(localFileKeys.preview({ ...tab, resourceScope: 'workspace' }))).toBe(true);
  });

  it('still matches once the SWR layer appends the workspace id', () => {
    expect(matchLocalFilePreviewKey(tab)([...localFileKeys.preview(tab), 'ws_1'])).toBe(true);
  });

  it('leaves other files, directories, devices and sandboxes alone', () => {
    const match = matchLocalFilePreviewKey(tab);

    expect(match(localFileKeys.preview({ ...tab, filePath: '/repo/src/b.ts' }))).toBe(false);
    expect(match(localFileKeys.preview({ ...tab, workingDirectory: '/other' }))).toBe(false);
    expect(match(localFileKeys.preview({ ...tab, deviceId: 'dev_1' }))).toBe(false);
    expect(match(localFileKeys.preview({ ...tab, sandboxTopicId: 'tpc_1' }))).toBe(false);
    expect(match(['localFile:projectIndex', 'local', '/repo'])).toBe(false);
    expect(match('localFile:preview')).toBe(false);
  });

  it('targets the device or sandbox a tab lives on', () => {
    const deviceTab = { ...tab, deviceId: 'dev_1' };
    const sandboxTab = { ...tab, sandboxTopicId: 'tpc_1' };

    expect(matchLocalFilePreviewKey(deviceTab)(localFileKeys.preview(deviceTab))).toBe(true);
    expect(matchLocalFilePreviewKey(sandboxTab)(localFileKeys.preview(sandboxTab))).toBe(true);
  });
});
