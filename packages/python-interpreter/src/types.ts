export interface PythonOptions {
  /**
   * Pyodide CDN URL
   */
  pyodideIndexUrl?: string;
  /**
   * PyPI index URL, must support [JSON API](https://warehouse.pypa.io/api-reference/json.html)
   *
   * Default value: `https://pypi.org/pypi/{package_name}/json`
   */
  pypiIndexUrl?: string;
}

export interface PythonOutput {
  data: string;
  type: 'stdout' | 'stderr';
}

export interface PythonResult {
  output?: PythonOutput[];
  result?: string;
  success: boolean;
}
