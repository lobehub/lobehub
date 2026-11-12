// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the Vite ?url import
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/assets/pdf.worker.min-abc123.mjs',
}));

// Capture the workerSrc assignments
const mockGlobalWorkerOptions = { workerSrc: '' };

vi.mock('react-pdf', () => ({
  Document: ({ children, loading, ...props }: any) => (
    <div data-testid="pdf-document" {...props}>
      {children}
    </div>
  ),
  Page: (props: any) => <div data-testid="pdf-page" {...props} />,
  pdfjs: {
    GlobalWorkerOptions: mockGlobalWorkerOptions,
    version: '5.4.530',
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reset module-level singleton (`workerReady`) between tests */
const loadFreshModule = async () => {
  vi.resetModules();
  // Re-apply mocks after resetModules
  vi.doMock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
    default: '/assets/pdf.worker.min-abc123.mjs',
  }));
  vi.doMock('react-pdf', () => ({
    Document: ({ children, ...props }: any) => (
      <div data-testid="pdf-document" {...props}>
        {children}
      </div>
    ),
    Page: (props: any) => <div data-testid="pdf-page" {...props} />,
    pdfjs: {
      GlobalWorkerOptions: mockGlobalWorkerOptions,
      version: '5.4.530',
    },
  }));

  return import('./index');
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('src/libs/pdfjs', () => {
  let originalProtocol: PropertyDescriptor | undefined;

  beforeEach(() => {
    mockGlobalWorkerOptions.workerSrc = '';
    originalProtocol = Object.getOwnPropertyDescriptor(window.location, 'protocol');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    if (originalProtocol) {
      Object.defineProperty(window.location, 'protocol', originalProtocol);
    }
  });

  describe('worker initialization', () => {
    it('should use pdfjsWorkerUrl directly for http: protocol', async () => {
      // happy-dom defaults to http:
      const mod = await loadFreshModule();

      // Wait for the eager initialization to complete
      await vi.dynamicImportSettled?.();
      // Give the async init a tick to settle
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min-abc123.mjs');
      expect(mod.Document).toBeDefined();
      expect(mod.Page).toBeDefined();
    });

    it('should use pdfjsWorkerUrl directly for https: protocol', async () => {
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'https:',
      });

      await loadFreshModule();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.min-abc123.mjs');
    });

    it('should create blob URL for app: protocol (Electron)', async () => {
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'app:',
      });

      const mockBlobUrl = 'blob:app://renderer/fake-uuid';
      const mockBlob = new Blob(['worker code'], { type: 'application/javascript' });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue(mockBlobUrl);

      await loadFreshModule();
      await new Promise((r) => setTimeout(r, 0));

      expect(globalThis.fetch).toHaveBeenCalledWith('/assets/pdf.worker.min-abc123.mjs');
      expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockGlobalWorkerOptions.workerSrc).toBe(mockBlobUrl);
    });

    it('should fallback to CDN when fetch fails in app: protocol', async () => {
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'app:',
      });

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      await loadFreshModule();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGlobalWorkerOptions.workerSrc).toBe(
        'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs',
      );
    });

    it('should fallback to CDN when fetch returns non-OK response in app: protocol', async () => {
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'app:',
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await loadFreshModule();
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGlobalWorkerOptions.workerSrc).toBe(
        'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs',
      );
    });
  });

  describe('Document component', () => {
    it('should render loading state while worker initializes', async () => {
      // Simulate app: protocol with a slow fetch to keep worker pending
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'app:',
      });

      let resolveFetch: (value: any) => void;
      const fetchPromise = new Promise((r) => {
        resolveFetch = r;
      });

      globalThis.fetch = vi.fn().mockReturnValue(fetchPromise);

      const mod = await loadFreshModule();
      const { Document } = mod;

      render(
        <Document file="test.pdf" loading={<div data-testid="loading">Loading...</div>}>
          <div>PDF Content</div>
        </Document>,
      );

      // Should show loading since worker isn't ready yet
      expect(screen.queryByTestId('loading')).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-document')).not.toBeInTheDocument();

      // Resolve fetch to complete worker init
      const mockBlob = new Blob(['worker'], { type: 'application/javascript' });
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
      await act(async () => {
        resolveFetch!({ ok: true, blob: () => Promise.resolve(mockBlob) });
      });

      expect(screen.queryByTestId('pdf-document')).toBeInTheDocument();
    });

    it('should render null when no loading prop provided and worker not ready', async () => {
      Object.defineProperty(window.location, 'protocol', {
        configurable: true,
        value: 'app:',
      });

      let resolveFetch: (value: any) => void;
      globalThis.fetch = vi.fn().mockReturnValue(
        new Promise((r) => {
          resolveFetch = r;
        }),
      );

      const mod = await loadFreshModule();
      const { Document } = mod;

      const { container } = render(
        <Document file="test.pdf">
          <div>PDF Content</div>
        </Document>,
      );

      // No loading prop → renders null
      expect(container.innerHTML).toBe('');

      // Cleanup: resolve the pending fetch
      const mockBlob = new Blob(['worker'], { type: 'application/javascript' });
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
      await act(async () => {
        resolveFetch!({ ok: true, blob: () => Promise.resolve(mockBlob) });
      });
    });

    it('should render PdfDocument immediately for http: protocol', async () => {
      // http: protocol → workerSrc set synchronously at module load
      const mod = await loadFreshModule();
      await new Promise((r) => setTimeout(r, 0));

      const { Document } = mod;

      await act(async () => {
        render(
          <Document file="test.pdf">
            <div>PDF Content</div>
          </Document>,
        );
      });

      expect(screen.queryByTestId('pdf-document')).toBeInTheDocument();
    });
  });

  describe('exports', () => {
    it('should export Page component', async () => {
      const mod = await loadFreshModule();
      expect(mod.Page).toBeDefined();
    });

    it('should export pdfjs', async () => {
      const mod = await loadFreshModule();
      expect(mod.pdfjs).toBeDefined();
      expect(mod.pdfjs.version).toBe('5.4.530');
    });
  });
});
