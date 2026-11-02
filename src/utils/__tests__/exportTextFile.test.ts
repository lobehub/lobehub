/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportFileName, exportHtmlDocument } from '../exportTextFile';

const mocks = vi.hoisted(() => ({ exportFile: vi.fn(), isDesktop: false }));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@/services/electron/desktopExportService', () => ({
  desktopExportService: { exportFile: mocks.exportFile },
}));

describe('exportFileName', () => {
  it('appends the extension once and names an untitled export', () => {
    expect(exportFileName('Goal report', 'html')).toBe('Goal report.html');
    expect(exportFileName('report.HTML', 'html')).toBe('report.HTML');
    expect(exportFileName('  ', 'html')).toBe('Untitled.html');
  });
});

describe('exportHtmlDocument', () => {
  const HTML = '<!doctype html><html><body>Report</body></html>';

  beforeEach(() => {
    mocks.isDesktop = false;
    mocks.exportFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads the page itself as a .html file in the browser', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:report');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(exportHtmlDocument(HTML, 'Goal report')).resolves.toBe('downloaded');

    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Goal report.html');
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/html');
    expect(await blob.text()).toBe(HTML);
  });

  it('saves through the desktop dialog with an HTML filter', async () => {
    mocks.isDesktop = true;
    mocks.exportFile.mockResolvedValue({ canceled: false, filePath: '/tmp/Goal report.html' });

    await expect(exportHtmlDocument(HTML, 'Goal report')).resolves.toBe('saved');

    expect(mocks.exportFile).toHaveBeenCalledWith({
      content: HTML,
      fileName: 'Goal report.html',
      filter: { extensions: ['html'], name: 'HTML' },
    });
  });

  it('reports a canceled desktop save', async () => {
    mocks.isDesktop = true;
    mocks.exportFile.mockResolvedValue({ canceled: true });

    await expect(exportHtmlDocument(HTML, null)).resolves.toBe('canceled');
  });
});
