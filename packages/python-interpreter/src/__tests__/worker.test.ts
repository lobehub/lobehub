// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('comlink', () => ({
  expose: vi.fn(),
}));

describe('PythonWorker', () => {
  const mockPyodide = {
    FS: {
      mkdirTree: vi.fn(),
      chdir: vi.fn(),
      writeFile: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
    },
    loadPackage: vi.fn(),
    pyimport: vi.fn(),
    loadPackagesFromImports: vi.fn(),
    setStdout: vi.fn(),
    setStderr: vi.fn(),
    runPythonAsync: vi.fn(),
    loadedPackages: {},
  };

  const mockMicropip = {
    set_index_urls: vi.fn(),
    install: vi.fn(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    // Setup minimal global mocks
    vi.stubGlobal('importScripts', vi.fn());
    vi.stubGlobal('loadPyodide', vi.fn().mockResolvedValue(mockPyodide));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      }),
    );

    mockPyodide.pyimport.mockReturnValue(mockMicropip);
    mockPyodide.loadedPackages = {};
  });

  const importWorker = async () => {
    const { PythonWorker } = await import('../worker');
    return { PythonWorker };
  };

  describe('constructor', () => {
    it('should initialize with default options', () => {
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker({});

        expect(worker.pypiIndexUrl).toBe('PYPI');
        expect(worker.pyodideIndexUrl).toBe('https://cdn.jsdelivr.net/pyodide/v0.28.2/full');
        expect(worker.uploadedFiles).toEqual([]);
      });
    });

    it('should initialize with custom options', () => {
      const options = {
        pyodideIndexUrl: 'https://test.cdn.com/pyodide',
        pypiIndexUrl: 'https://test.pypi.org',
      };
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker(options);

        expect(worker.pypiIndexUrl).toBe('https://test.pypi.org');
        expect(worker.pyodideIndexUrl).toBe('https://test.cdn.com/pyodide');
      });
    });

    it('should call importScripts with pyodide.js', () => {
      return importWorker().then(({ PythonWorker }) => {
        new PythonWorker({});
        expect(globalThis.importScripts).toHaveBeenCalledWith(
          expect.stringContaining('/pyodide.js'),
        );
      });
    });
  });

  describe('pyodide getter', () => {
    it('should throw error when pyodide is not initialized', () => {
      return importWorker().then(({ PythonWorker }) => {
        const worker = new PythonWorker({});
        expect(() => worker.pyodide).toThrow('Python interpreter not initialized');
      });
    });

    it('should return pyodide when initialized', async () => {
      const { PythonWorker } = await importWorker();
      const worker = new PythonWorker({});
      await worker.init();
      expect(worker.pyodide).toBe(mockPyodide);
    });
  });

  describe('init', () => {
    it('should initialize pyodide and setup filesystem', async () => {
      const { PythonWorker } = await importWorker();
      const worker = new PythonWorker({
        pyodideIndexUrl: 'https://test.cdn.com/pyodide',
      });

      await worker.init();

      expect(globalThis.loadPyodide).toHaveBeenCalledWith({
        indexURL: 'https://test.cdn.com/pyodide',
      });
      expect(mockPyodide.FS.mkdirTree).toHaveBeenCalledWith('/mnt/data');
      expect(mockPyodide.FS.chdir).toHaveBeenCalledWith('/mnt/data');
    });
  });

  describe('file operations', () => {
    let worker: any;

    beforeEach(async () => {
      const { PythonWorker } = await importWorker();
      worker = new PythonWorker({});
      await worker.init();
    });

    it('should upload files correctly', async () => {
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

      await worker.uploadFiles([mockFile]);

      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/mnt/data/test.txt',
        expect.any(Uint8Array),
      );
      expect(worker.uploadedFiles).toContain(mockFile);
    });

    it('should upload files with absolute path as-is', async () => {
      const absFile = new File([Uint8Array.from([1, 2])], '/abs.txt');
      await worker.uploadFiles([absFile]);
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith('/abs.txt', expect.any(Uint8Array));
    });

    it('should download new files from filesystem', async () => {
      const mockFileContent = new Uint8Array([1, 2, 3, 4]);

      mockPyodide.FS.readdir.mockReturnValue(['.', '..', 'output.txt']);
      (mockPyodide.FS as any).readFile.mockReturnValue(mockFileContent);

      const files = await worker.downloadFiles();

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('/mnt/data/output.txt');
    });

    it('should skip identical files in download (dedup)', async () => {
      const same = new File([Uint8Array.from([7, 8])], 'same.txt');
      await worker.uploadFiles([same]);

      mockPyodide.FS.readdir.mockReturnValue(['.', '..', 'same.txt']);
      (mockPyodide.FS as any).readFile.mockReturnValue(Uint8Array.from([7, 8]));

      const files = await worker.downloadFiles();
      expect(files).toHaveLength(0);
    });
  });

  describe('runPython', () => {
    let worker: any;

    beforeEach(async () => {
      const { PythonWorker } = await importWorker();
      worker = new PythonWorker({});
      await worker.init();
    });

    it('should execute python code successfully', async () => {
      const code = 'print("Hello, World!")';
      const expectedResult = 'Hello, World!';

      mockPyodide.runPythonAsync.mockResolvedValue(expectedResult);

      const result = await worker.runPython(code);

      expect(result.success).toBe(true);
      expect(result.result).toBe(expectedResult);
      expect(mockPyodide.runPythonAsync).toHaveBeenCalledWith(code);
    });

    it('should call loadPackagesFromImports with code', async () => {
      const code = 'print("x")';
      mockPyodide.runPythonAsync.mockResolvedValue('x');
      await worker.runPython(code);
      expect(mockPyodide.loadPackagesFromImports).toHaveBeenCalledWith(code);
    });

    it('should handle python execution errors', async () => {
      const error = new Error('SyntaxError: invalid syntax');
      mockPyodide.runPythonAsync.mockRejectedValue(error);

      const result = await worker.runPython('invalid code');

      expect(result.success).toBe(false);
      expect(result.output).toContainEqual({
        data: 'SyntaxError: invalid syntax',
        type: 'stderr',
      });
    });

    it('should install packages using micropip', async () => {
      const packages = ['numpy', 'pandas'];

      await worker.installPackages(packages);

      expect(mockPyodide.loadPackage).toHaveBeenCalledWith('micropip');
      expect(mockMicropip.set_index_urls).toHaveBeenCalledWith([worker.pypiIndexUrl, 'PYPI']);
      expect(mockMicropip.install).toHaveBeenCalledWith(packages);
    });

    it('should patch matplotlib when loaded', async () => {
      mockPyodide.loadedPackages = { matplotlib: true } as any;
      mockPyodide.runPythonAsync.mockResolvedValueOnce(undefined).mockResolvedValueOnce('ok');
      const res = await worker.runPython('print(1)');
      expect(res.success).toBe(true);
      expect(mockPyodide.runPythonAsync).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('patch_matplotlib()'),
      );
    });

    it('should write fonts into truetype directory before run', async () => {
      mockPyodide.runPythonAsync.mockResolvedValue('ok');
      await worker.runPython('print(1)');
      expect(mockPyodide.FS.mkdirTree).toHaveBeenCalledWith('/usr/share/fonts/truetype');
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('/usr/share/fonts/truetype/STSong.ttf'),
        expect.any(Uint8Array),
      );
    });

    it('should stringify non-string result', async () => {
      mockPyodide.runPythonAsync.mockResolvedValue({ toString: () => '42' });
      const r = await worker.runPython('1+41');
      expect(r.success).toBe(true);
      expect(r.result).toBe('42');
    });
  });
});
