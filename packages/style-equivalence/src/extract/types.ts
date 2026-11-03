import type ts from 'typescript';

export type LiteralValue = string | number | boolean;

export type VariableKind = 'boolean' | 'call' | 'member' | 'unknown';

export interface VariableUse {
  kind: VariableKind;
  name: string;
}

export interface StyleBinding {
  expr: string;
  prop: string;
  spread: boolean;
}

export interface StyleElement {
  bindings: StyleBinding[];
  flags: string[];
  id: string;
  literalProps: Record<string, LiteralValue>;
  owner: string;
  parent?: string;
  slots: string[];
  tag: string;
  variables: VariableUse[];
}

export interface StyleRule {
  conditions: string[];
  selector: string;
  slot?: string;
}

export interface FileExtraction {
  elements: StyleElement[];
  file: string;
  gaps: string[];
  outsideReferences: string[];
  prelude: string;
  rules: StyleRule[];
  styleSymbols: string[];
}

export interface StyleAdapter {
  importedStyleSymbols?: (source: string, clause: ts.ImportClause) => string[];
  markerIdentifiers: string[];
  name: string;
  recognizeFactory: (call: ts.CallExpression) => boolean;
  rulesOf?: (symbol: string, initializer: ts.Expression) => StyleRule[];
}

export interface ExtractOptions {
  adapters: StyleAdapter[];
  layoutComponents: string[];
}
