import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import postcss from 'postcss';
import ts from 'typescript';

import { sha256 } from '../reporting/report';
import type { CompositionTrace } from './compositionObserver';
import { planCompositionObserver } from './compositionObserver';
import { analyzeSelector } from './selectorAnalysis';

export interface StyleBindingPlan {
  bindings: Array<{
    kind: 'css-module' | 'static-factory';
    symbol: string;
    slots: Array<{ end: number; name: string; start: number; unitId: string }>;
  }>;
  composition?: CompositionTrace;
  gaps: string[];
  source: string;
  sourceHash: string;
  stylesheets: Array<{
    file: string;
    hash: string;
    rules: Array<{
      conditions: Array<{ kind: string; text: string }>;
      end: number;
      selector: string;
      start: number;
    }>;
  }>;
}

/** Observes existing module bindings; never assigns classes to product nodes. */
export const analyzeStyleBindings = (code: string, file: string) => {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const factories = new Set<string>();
  const imports: Array<{ source: string; symbol: string }> = [];
  const bindings: StyleBindingPlan['bindings'] = [];
  const gaps: string[] = [];
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name && statement.moduleSpecifier.text.endsWith('.module.css'))
      imports.push({ source: statement.moduleSpecifier.text, symbol: clause.name.text });
    if (
      ['@lobehub/ui', 'antd-style'].includes(statement.moduleSpecifier.text) &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings)
    )
      for (const element of clause.namedBindings.elements)
        if (
          !element.isTypeOnly &&
          (element.propertyName?.text ?? element.name.text) === 'createStaticStyles'
        )
          factories.add(element.name.text);
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        !call ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        !factories.has(call.expression.text)
      )
        continue;
      const callback = call.arguments[0];
      const body =
        callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
          ? callback.body
          : undefined;
      if (
        body &&
        ts.isBlock(body) &&
        body.statements.some(
          (statement) => !ts.isVariableStatement(statement) && !ts.isReturnStatement(statement),
        )
      ) {
        gaps.push('STATIC_FACTORY_CONTROL_FLOW_UNSUPPORTED');
        continue;
      }
      let returned =
        body && ts.isBlock(body) ? body.statements.find(ts.isReturnStatement)?.expression : body;
      while (
        returned &&
        (ts.isParenthesizedExpression(returned) ||
          ts.isAsExpression(returned) ||
          ts.isSatisfiesExpression(returned) ||
          ts.isTypeAssertionExpression(returned))
      )
        returned = returned.expression;
      if (!returned || !ts.isObjectLiteralExpression(returned)) {
        gaps.push('STATIC_FACTORY_RETURN_UNSUPPORTED');
        continue;
      }
      const slots: StyleBindingPlan['bindings'][number]['slots'] = [];
      for (const property of returned.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
        ) {
          gaps.push('DYNAMIC_STYLE_SLOT_UNSUPPORTED');
          continue;
        }
        slots.push({
          end: property.end,
          name: property.name.text,
          start: property.getStart(ast),
          unitId: `${file}:style-slot:${property.getStart(ast)}`,
        });
      }
      bindings.push({ kind: 'static-factory', slots, symbol: declaration.name.text });
      // The observer proves slot identity, not that template compilation was complete.
      gaps.push('LEGACY_TEMPLATE_RULE_SOURCE_UNPROVEN');
    }
  }
  if (!bindings.length && !imports.length) gaps.push('STYLE_BINDING_ADAPTER_UNAVAILABLE');
  return { bindings, gaps, imports };
};

export const prepareStyleBindings = async (
  directory: string,
  source: string,
): Promise<StyleBindingPlan> => {
  const root = await realpath(directory);
  const file = await realpath(path.resolve(root, source));
  if (!file.startsWith(root + path.sep)) throw new Error('STYLE_BINDING_SOURCE_ESCAPE');
  const code = await readFile(file, 'utf8');
  const analysis = analyzeStyleBindings(code, source);
  const composition = planCompositionObserver(code, source);
  const stylesheets: StyleBindingPlan['stylesheets'] = [];
  if (analysis.imports.length > 20 || code.length > 4 * 1024 ** 2)
    throw new Error('STYLE_BINDING_SOURCE_BUDGET_EXCEEDED');
  for (const imported of analysis.imports) {
    if (!imported.source.startsWith('.')) {
      analysis.gaps.push('CSS_MODULE_SOURCE_ALIAS_UNSUPPORTED');
      continue;
    }
    const cssFile = await realpath(path.resolve(path.dirname(file), imported.source));
    if (!cssFile.startsWith(root + path.sep)) throw new Error('STYLE_BINDING_SOURCE_ESCAPE');
    const css = await readFile(cssFile, 'utf8');
    if (css.length > 4 * 1024 ** 2) throw new Error('STYLE_BINDING_SOURCE_BUDGET_EXCEEDED');
    const cssPath = path.relative(root, cssFile);
    const rules: StyleBindingPlan['stylesheets'][number]['rules'] = [];
    const classes = new Set<string>();
    const parsed = postcss.parse(css, { from: cssPath });
    parsed.walkRules((rule) => {
      const conditions: Array<{ kind: string; text: string }> = [];
      for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
        if (parent.type === 'atrule')
          conditions.unshift({ kind: parent.name, text: parent.params });
        else if (parent.type === 'rule') analysis.gaps.push('SOURCE_NATIVE_NESTING_UNBOUND');
      }
      try {
        analyzeSelector(rule.selector).forEach((selector) => {
          selector.classes.forEach((name) => classes.add(name));
          analysis.gaps.push(...selector.gaps);
        });
      } catch (error) {
        console.error('SOURCE_SELECTOR_PARSE_ERROR', error);
        analysis.gaps.push('SOURCE_SELECTOR_PARSE_ERROR');
      }
      rules.push({
        conditions,
        end: rule.source?.end?.offset ?? css.length,
        selector: rule.selector,
        start: rule.source?.start?.offset ?? 0,
      });
    });
    analysis.bindings.push({
      kind: 'css-module',
      symbol: imported.symbol,
      slots: [...classes]
        .sort()
        .map((name) => ({ name, start: 0, end: css.length, unitId: `${cssPath}:stylesheet:0` })),
    });
    stylesheets.push({ file: cssPath, hash: sha256(css), rules });
  }
  return {
    bindings: analysis.bindings,
    composition,
    gaps: [...new Set([...analysis.gaps, ...composition.gaps])],
    source,
    sourceHash: sha256(code),
    stylesheets,
  };
};

export const bindingObserverExport = (plan: StyleBindingPlan) => {
  for (const binding of plan.bindings)
    if (!/^[$A-Z_][$\w]*$/i.test(binding.symbol)) throw new Error('INVALID_STYLE_BINDING_SYMBOL');
  return `\nexport const __styleVerificationBindings = {${plan.bindings.map(({ symbol }) => `${JSON.stringify(symbol)}:${symbol}`).join(',')}};\n`;
};
