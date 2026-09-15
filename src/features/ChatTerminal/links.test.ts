import { beforeEach, describe, expect, it, vi } from 'vitest';

import { electronSystemService } from '@/services/electron/system';

import { openTerminalLink } from './links';

vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('openTerminalLink', () => {
  it('hands http(s) links to the system browser', () => {
    openTerminalLink('https://lobehub.com/docs?a=1#x');

    expect(electronSystemService.openExternalLink).toHaveBeenCalledWith(
      'https://lobehub.com/docs?a=1#x',
    );
  });

  it.each(['file:///etc/passwd', 'vscode://x', 'javascript:alert(1)', 'mailto:a@b.com'])(
    'refuses to open %s — terminal output is attacker-reachable and the main process does no check',
    (uri) => {
      openTerminalLink(uri);

      expect(electronSystemService.openExternalLink).not.toHaveBeenCalled();
    },
  );

  it('ignores text that is not a URL at all', () => {
    openTerminalLink('not a link');

    expect(electronSystemService.openExternalLink).not.toHaveBeenCalled();
  });
});
