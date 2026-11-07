import type ts from 'typescript';

import type { ForwardResolution } from './forward';

export type LiteralValue = string | number | boolean | { [key: string]: LiteralValue };

export type VariableKind = 'boolean' | 'call' | 'member' | 'unknown';

export interface VariableUse {
  kind: VariableKind;
  name: string;
}

export interface StyleBinding {
  expansion?: string;
  expr: string;
  prop: string;
  spread: boolean;
}

export interface StyleElement {
  aliases?: Record<string, string>;
  attributes?: Record<string, string>;
  bindings: StyleBinding[];
  children?: string[];
  derived?: Record<string, string>;
  flags: string[];
  foreignSpread?: boolean;
  forwardedParam?: string;
  forwards?: ForwardResolution[];
  guards?: string[];
  iconElement?: boolean | string;
  id: string;
  inlineStyle?: string;
  literalProps: Record<string, LiteralValue>;
  owner: string;
  parent?: string;
  real?: boolean;
  runtimeStyle?: string;
  slots: string[];
  spreadAfterStyle?: boolean;
  styleExpr?: string;
  subtreeComponents?: string[];
  subtreeTags?: Record<string, number>;
  tag: string;
  variables: VariableUse[];
}

export interface StyleRule {
  conditions: string[];
  declarations?: string[];
  interpolations?: string[];
  interpolationValues?: Array<string | null>;
  owned: Record<string, string>;
  selector: string;
  slot?: string;
  stylesheet?: string;
}

export type StylesheetBinding = { kind: 'global' } | { kind: 'module'; symbol: string };

export interface FileExtraction {
  elements: StyleElement[];
  file: string;
  gaps: string[];
  globalRules?: StyleRule[];
  literalClasses?: string[];
  outsideReferences: string[];
  plain?: StyleElement[];
  prelude: string;
  rules: StyleRule[];
  slotConditions?: Record<string, string[]>;
  slotProperties?: Record<string, string[]>;
  styleSymbols: string[];
  tables?: Record<string, string[]>;
  unsupported?: Record<string, string[]>;
}

export interface StyleAdapter {
  conditionsOf?: (symbol: string, factory: ts.CallExpression) => Record<string, string[]>;
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

export interface RealComponent {
  leaf?: boolean;
  sample?: (content: string) => string;
  source: string;
  tag?: { default: string; prop: string };
}

export interface ExtractOptions {
  adapters: StyleAdapter[];
  layoutComponents: string[];
  readBaseModule?: (fromFile: string, specifier: string) => string | undefined;
  readModule?: (fromFile: string, specifier: string) => string | undefined;
  readStylesheet?: (fromFile: string, specifier: string) => string | undefined;
  realComponents?: Record<string, RealComponent>;
}
