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
  runtimeStyle?: string;
  slots: string[];
  tag: string;
  variables: VariableUse[];
}

export interface StyleRule {
  conditions: string[];
  owned: Record<string, string>;
  selector: string;
  slot?: string;
}

export type StylesheetBinding = { kind: 'global' } | { kind: 'module'; symbol: string };

export interface FileExtraction {
  elements: StyleElement[];
  file: string;
  gaps: string[];
  outsideReferences: string[];
  prelude: string;
  rules: StyleRule[];
  slotProperties?: Record<string, string[]>;
  styleSymbols: string[];
  tables?: Record<string, string[]>;
}

export interface StyleAdapter {
  importedStyleSymbols?: (source: string, clause: ts.ImportClause) => string[];
  markerIdentifiers: string[];
  name: string;
  propertiesOf?: (symbol: string, factory: ts.CallExpression) => Record<string, string[]>;
  recognizeFactory: (call: ts.CallExpression) => boolean;
  rulesOf?: (symbol: string, factory: ts.CallExpression) => StyleRule[];
  stylesheet?: (
    source: string,
    clause: ts.ImportClause | undefined,
  ) => StylesheetBinding | undefined;
}

export interface ExtractOptions {
  adapters: StyleAdapter[];
  layoutComponents: string[];
  readModule?: (fromFile: string, specifier: string) => string | undefined;
  readStylesheet?: (fromFile: string, specifier: string) => string | undefined;
}
