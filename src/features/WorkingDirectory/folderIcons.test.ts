import {
  DownloadIcon,
  FilesIcon,
  FolderIcon,
  ImageIcon,
  LayoutGridIcon,
  LibraryIcon,
  MonitorIcon,
  MusicIcon,
  VideoIcon,
} from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { getFolderIcon } from './folderIcons';

describe('getFolderIcon', () => {
  it.each([
    ['Downloads', DownloadIcon],
    ['Documents', FilesIcon],
    ['Desktop', MonitorIcon],
    ['Pictures', ImageIcon],
    ['Music', MusicIcon],
    ['Videos', VideoIcon],
    ['Movies', VideoIcon],
    ['Applications', LayoutGridIcon],
    ['Library', LibraryIcon],
  ])('maps well-known folder %s to its purpose icon', (name, icon) => {
    expect(getFolderIcon(name)).toBe(icon);
  });

  it('matches names case-insensitively', () => {
    expect(getFolderIcon('downloads')).toBe(DownloadIcon);
    expect(getFolderIcon('PICTURES')).toBe(ImageIcon);
  });

  it.each(['CodeProjects', 'image-advisor-output', '', 'downloads-old'])(
    'falls back to a plain folder icon for %s',
    (name) => {
      expect(getFolderIcon(name)).toBe(FolderIcon);
    },
  );
});
