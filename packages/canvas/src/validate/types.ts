export type CanvasIssueRule =
  | 'broken-reference'
  | 'duplicate-path'
  | 'entry-missing'
  | 'file-too-large'
  | 'file-type-mismatch'
  | 'hard-coded-color'
  | 'invalid-attribute'
  | 'invalid-diagram'
  | 'invalid-path'
  | 'misplaced-component'
  | 'missing-attribute'
  | 'network-api'
  | 'markup-in-text'
  | 'project-too-large'
  | 'quota-exceeded'
  | 'remote-resource'
  | 'self-closing-component'
  | 'too-many-files'
  | 'unknown-attribute'
  | 'unknown-component'
  | 'unresolved-file-ref';

export interface CanvasIssue {
  file?: string;
  line?: number;
  message: string;
  rule: CanvasIssueRule;
}

export interface CanvasValidationResult {
  issues: CanvasIssue[];
  ok: boolean;
}

export interface CanvasMermaidProblem {
  line?: number;
  message: string;
}

export interface CanvasValidationOptions {
  checkMermaid?: (source: string) => CanvasMermaidProblem | undefined;
}

export interface CanvasProjectFile {
  content: string | Uint8Array;
  path: string;
  size?: number;
}
