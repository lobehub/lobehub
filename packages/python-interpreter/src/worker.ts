import * as Comlink from 'comlink';
import type { loadPyodide as loadPyodideType, PyodideAPI } from 'pyodide';
import urlJoin from 'url-join';

import type { PythonOptions, PythonOutput, PythonResult } from './types';

declare global {
  var loadPyodide: typeof loadPyodideType;
}

const PATCH_MATPLOTLIB = `
def patch_matplotlib():
  import matplotlib
  import matplotlib.pyplot as plt
  from matplotlib import font_manager

  # patch plt.show
  matplotlib.use('Agg')
  index = 1
  def show():
    nonlocal index
    plt.savefig(f'/mnt/data/plot_{index}.png', format="png")
    plt.clf()
    index += 1
  plt.show = show

  # patch fonts
  font_path = '/usr/share/fonts/truetype/STSong.ttf'
  font_manager.fontManager.addfont(font_path)
  plt.rcParams['font.family'] = 'STSong'

patch_matplotlib()`;

// Pyodide object cannot be transferred between Workers, so it's defined as a global variable
let pyodide: PyodideAPI | undefined;

class PythonWorker {
  pyodideIndexUrl: string;
  pypiIndexUrl: string;
  uploadedFiles: File[];

  constructor(options: PythonOptions) {
    this.pypiIndexUrl = options.pypiIndexUrl || 'PYPI';
    this.pyodideIndexUrl =
      options.pyodideIndexUrl || 'https://cdn.jsdelivr.net/pyodide/v0.28.2/full';
    globalThis.importScripts(urlJoin(this.pyodideIndexUrl, 'pyodide.js'));
    this.uploadedFiles = [];
  }

  get pyodide() {
    if (!pyodide) {
      throw new Error('Python interpreter not initialized');
    }
    return pyodide;
  }

  /**
   * Initialize Python interpreter
   */
  async init() {
    pyodide = await globalThis.loadPyodide({
      indexURL: this.pyodideIndexUrl,
    });
    pyodide.FS.mkdirTree('/mnt/data');
    pyodide.FS.chdir('/mnt/data');
  }

  /**
   * Upload files to the interpreter environment
   * @param files File list
   */
  async uploadFiles(files: File[]) {
    for (const file of files) {
      const content = new Uint8Array(await file.arrayBuffer());
      // TODO: Consider using WORKERFS here to reduce one copy operation
      if (file.name.startsWith('/')) {
        this.pyodide.FS.writeFile(file.name, content);
      } else {
        this.pyodide.FS.writeFile(`/mnt/data/${file.name}`, content);
      }
      this.uploadedFiles.push(file);
    }
  }

  /**
   * Download modified files from the interpreter environment
   * @param files File list
   */
  async downloadFiles() {
    const result: File[] = [];
    for (const entry of this.pyodide.FS.readdir('/mnt/data')) {
      if (entry === '.' || entry === '..') continue;
      const filePath = `/mnt/data/${entry}`;
      // pyodide's FS type definition has issues, have to use any
      const content = (this.pyodide.FS as any).readFile(filePath, { encoding: 'binary' });
      const blob = new Blob([content]);
      const file = new File([blob], filePath);
      if (await this.isNewFile(file)) {
        result.push(file);
      }
    }
    return result;
  }

  /**
   * Install Python packages
   * @param packages Package name list
   */
  async installPackages(packages: string[]) {
    await this.pyodide.loadPackage('micropip');
    const micropip = this.pyodide.pyimport('micropip');
    micropip.set_index_urls([this.pypiIndexUrl, 'PYPI']);
    await micropip.install(packages);
  }

  /**
   * Execute Python code
   * @param code Code
   */
  async runPython(code: string): Promise<PythonResult> {
    await this.patchFonts();
    // NOTE: loadPackagesFromImports only processes official pyodide packages
    await this.pyodide.loadPackagesFromImports(code);
    await this.patchPackages();

    // Capture standard output after installing dependencies to avoid logging installation messages
    const output: PythonOutput[] = [];
    this.pyodide.setStdout({
      batched: (o: string) => {
        output.push({ data: o, type: 'stdout' });
      },
    });
    this.pyodide.setStderr({
      batched: (o: string) => {
        output.push({ data: o, type: 'stderr' });
      },
    });

    // Execute code
    let result;
    let success = false;
    try {
      result = await this.pyodide.runPythonAsync(code);
      success = true;
    } catch (error) {
      output.push({
        data: error instanceof Error ? error.message : String(error),
        type: 'stderr',
      });
    }

    return {
      output,
      result: result?.toString(),
      success,
    };
  }

  private async patchPackages() {
    const hasMatplotlib = Object.keys(this.pyodide.loadedPackages).includes('matplotlib');
    if (hasMatplotlib) {
      await this.pyodide.runPythonAsync(PATCH_MATPLOTLIB);
    }
  }

  private async patchFonts() {
    this.pyodide.FS.mkdirTree('/usr/share/fonts/truetype');
    const fontFiles = {
      'STSong.ttf':
        'https://cdn.jsdelivr.net/gh/Haixing-Hu/latex-chinese-fonts@latest/chinese/宋体/STSong.ttf',
    };
    for (const [filename, url] of Object.entries(fontFiles)) {
      const buffer = await fetch(url, { cache: 'force-cache' }).then((res) => res.arrayBuffer());
      // NOTE: In theory, createLazyFile would be better here, but it causes errors in pyodide
      this.pyodide.FS.writeFile(`/usr/share/fonts/truetype/${filename}`, new Uint8Array(buffer));
    }
  }

  private async isNewFile(file: File) {
    const isSameFile = async (a: File, b: File) => {
      // a is the passed-in file, may use absolute or relative path
      // b is the file in the interpreter environment, uses absolute path
      if (a.name.startsWith('/')) {
        if (a.name !== b.name) return false;
      } else {
        if (`/mnt/data/${a.name}` !== b.name) return false;
      }

      if (a.size !== b.size) return false;

      const aBuffer = await a.arrayBuffer();
      const bBuffer = await b.arrayBuffer();
      const aArray = new Uint8Array(aBuffer);
      const bArray = new Uint8Array(bBuffer);
      const length = aArray.length;
      for (let i = 0; i < length; i++) {
        if (aArray[i] !== bArray[i]) return false;
      }

      return true;
    };
    const t = await Promise.all(this.uploadedFiles.map((f) => isSameFile(f, file)));
    return t.every((f) => !f);
  }
}

Comlink.expose(PythonWorker);

export { PythonWorker };
export type PythonWorkerType = typeof PythonWorker;
