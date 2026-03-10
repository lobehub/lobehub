import { PythonInterpreter } from '@lobechat/python-interpreter';
import { type CodeInterpreterResponse } from '@lobechat/types';

import { pythonEnv } from '@/envs/python';

class PythonService {
  async runPython(
    code: string,
    packages: string[],
    files: File[],
  ): Promise<CodeInterpreterResponse | undefined> {
    if (typeof Worker === 'undefined') return;
    const interpreter = await new PythonInterpreter!({
      pyodideIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_INDEX_URL!,
      pypiIndexUrl: pythonEnv.NEXT_PUBLIC_PYODIDE_PIP_INDEX_URL!,
    });
    await interpreter.init();
    await interpreter.installPackages(packages.filter((p) => p !== ''));
    await interpreter.uploadFiles(files);

    const result = await interpreter.runPython(code);

    const resultFiles = await interpreter.downloadFiles();
    return {
      files: resultFiles.map((file) => ({
        data: file,
        filename: file.name,
        previewUrl: URL.createObjectURL(file),
      })),
      ...result,
    };
  }
}

export const pythonService = new PythonService();
