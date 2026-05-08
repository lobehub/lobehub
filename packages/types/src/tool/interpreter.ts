export interface CodeInterpreterParams {
  code: string;
  packages: string[];
}

export interface CodeInterpreterFileItem {
  data?: File;
  fileId?: string;
  filename: string;
  previewUrl?: string;
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

export interface CodeInterpreterResponse extends PythonResult {
  files?: CodeInterpreterFileItem[];
}

export interface CodeInterpreterState {
  error?: any;
}
