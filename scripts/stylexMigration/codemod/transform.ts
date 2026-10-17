/**
 * Rewrites one file from createStaticStyles to stylex.create.
 *
 * - `const styles = createStaticStyles(({ css, cssVar }) => ({ k: css`…` }))`
 *   becomes `const styles = stylex.create({ k: { … } })`.
 * - `className={styles.k}` / `className={cx(styles.a, on && styles.b)}` become
 *   `{...stylex.props(…)}` when the element has no `style` attribute.
 * - Any other `styles.k` becomes `stylex.props(styles.k).className`, and each
 *   `cx(…)` call keeps one `stylex.props(…)` for all of its style arguments so
 *   StyleX still resolves them in argument order.
 *
 * Throws UnsupportedCssError for anything it cannot rewrite faithfully.
 */
import ts from 'typescript';

import { convertCss, type TokenNames, UnsupportedCssError } from './css';

export interface TransformResult {
  code: string;
  /** cx() calls that merge StyleX classes with an outside className. */
  mergesOutsideClassName: number;
}

interface Edit {
  end: number;
  start: number;
  text: string;
}

const applyEdits = (source: string, edits: Edit[]) => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].end > sorted[i - 1].start) throw new Error('overlapping edits');
  }
  let out = source;
  for (const edit of sorted) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
};

const UI = '@lobehub/ui';

export const transformSource = (source: string, fileName = 'file.tsx'): TransformResult => {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const text = (node: ts.Node) => node.getText(sf);
  const edits: Edit[] = [];
  const replace = (node: ts.Node, value: string) =>
    edits.push({ end: node.getEnd(), start: node.getStart(sf), text: value });

  // Names imported from @lobehub/ui.
  const uiImports = new Map<string, string>(); // local → imported
  const uiImportDecls: ts.ImportDeclaration[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || (stmt.moduleSpecifier as ts.StringLiteral).text !== UI)
      continue;
    uiImportDecls.push(stmt);
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        uiImports.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
  }
  const localOf = (imported: string) => [...uiImports].find(([, name]) => name === imported)?.[0];
  const createLocal = localOf('createStaticStyles');
  if (!createLocal) throw new UnsupportedCssError('no createStaticStyles import');
  const cxLocal = localOf('cx');
  const outerCssVar = localOf('cssVar');
  const outerResponsive = localOf('responsive');
  if (outerCssVar && outerCssVar !== 'cssVar')
    throw new UnsupportedCssError('aliased cssVar import');

  const identifiers = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const name of ['stylex', 'media']) {
    if (identifiers.has(name)) throw new UnsupportedCssError(`file already declares ${name}`);
  }

  // Locate `const <name> = createStaticStyles(...)` declarations.
  const stylesNames = new Set<string>();
  let usesCssVar = false;
  let usesMedia = false;
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      const init = decl.initializer;
      if (!init || !ts.isCallExpression(init) || text(init.expression) !== createLocal) continue;
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
        throw new UnsupportedCssError('exported styles');
      if (!ts.isIdentifier(decl.name)) throw new UnsupportedCssError('destructured styles');
      stylesNames.add(decl.name.text);

      const fn = init.arguments[0];
      if (!fn || !ts.isArrowFunction(fn)) throw new UnsupportedCssError('styles factory');
      const names: TokenNames = {
        cssVar: new Set(outerCssVar ? [outerCssVar] : []),
        responsive: new Set(outerResponsive ? [outerResponsive] : []),
      };
      let cssTag: string | undefined;
      const param = fn.parameters[0];
      if (param) {
        if (!ts.isObjectBindingPattern(param.name)) throw new UnsupportedCssError('styles factory');
        for (const el of param.name.elements) {
          const key = (el.propertyName ?? el.name) as ts.Identifier;
          const local = (el.name as ts.Identifier).text;
          if (key.text === 'css') cssTag = local;
          else if (key.text === 'cssVar') names.cssVar.add(local);
          else if (key.text === 'responsive') names.responsive.add(local);
          else if (key.text !== 'cx') throw new UnsupportedCssError(`factory uses ${key.text}`);
        }
      }
      let body: ts.Node = fn.body;
      // `=> { return { … }; }` with nothing else in the block.
      if (ts.isBlock(body) && body.statements.length === 1) {
        const [only] = body.statements;
        if (ts.isReturnStatement(only) && only.expression) body = only.expression;
      }
      while (ts.isParenthesizedExpression(body)) body = body.expression;
      if (!ts.isObjectLiteralExpression(body)) throw new UnsupportedCssError('styles factory body');

      const entries: string[] = [];
      for (const prop of body.properties) {
        if (!ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name))
          throw new UnsupportedCssError('style entry');
        const value = prop.initializer;
        if (!ts.isTaggedTemplateExpression(value) || text(value.tag) !== cssTag)
          throw new UnsupportedCssError(`style entry ${text(prop.name)}`);
        const tpl = value.template;
        const raw = (node: ts.Node, trimStart: number, trimEnd: number) => {
          const s = text(node);
          return s.slice(trimStart, s.length - trimEnd);
        };
        const quasis = ts.isNoSubstitutionTemplateLiteral(tpl)
          ? [raw(tpl, 1, 1)]
          : [
              raw(tpl.head, 1, 2),
              ...tpl.templateSpans.map((span, i) =>
                raw(span.literal, 1, i === tpl.templateSpans.length - 1 ? 1 : 2),
              ),
            ];
        const expressions = ts.isNoSubstitutionTemplateLiteral(tpl)
          ? []
          : tpl.templateSpans.map((span) => text(span.expression));
        const converted = convertCss({ expressions, quasis }, names);
        usesCssVar ||= converted.usesCssVar;
        usesMedia ||= converted.usesMedia;
        entries.push(`${text(prop.name)}: ${converted.code}`);
      }
      replace(init, `stylex.create({ ${entries.join(', ')} })`);
    }
  }
  if (stylesNames.size === 0) throw new UnsupportedCssError('no top-level createStaticStyles');

  // Rewrite usages.
  const isStyleRef = (node: ts.Node): node is ts.PropertyAccessExpression =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    stylesNames.has(node.expression.text);
  /** `styles.k`, `cond && styles.k`, `cond ? styles.a : styles.b` (undefined/null allowed). */
  const isStyleArg = (node: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(node)) return isStyleArg(node.expression);
    if (isStyleRef(node)) return true;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    )
      return isStyleArg(node.right) && !containsStyleRef(node.left);
    if (ts.isConditionalExpression(node)) {
      const ok = (e: ts.Expression) =>
        isStyleArg(e) || e.kind === ts.SyntaxKind.NullKeyword || text(e) === 'undefined';
      return ok(node.whenTrue) && ok(node.whenFalse) && !containsStyleRef(node.condition);
    }
    return false;
  };
  const containsStyleRef = (node: ts.Node): boolean =>
    isStyleRef(node) || (ts.forEachChild(node, (c) => containsStyleRef(c) || undefined) ?? false);
  const isCx = (node: ts.Node): node is ts.CallExpression =>
    !!cxLocal && ts.isCallExpression(node) && text(node.expression) === cxLocal;

  let mergesOutsideClassName = 0;

  /** Splits cx args into StyleX ones and the rest; throws on mixed expressions. */
  const splitCx = (call: ts.CallExpression) => {
    const styleArgs: string[] = [];
    const rest: string[] = [];
    for (const arg of call.arguments) {
      if (isStyleArg(arg)) styleArgs.push(text(arg));
      else if (containsStyleRef(arg)) throw new UnsupportedCssError(`cx argument ${text(arg)}`);
      else {
        // Emotion let a later class win; StyleX rules outrank plain classes, so a
        // class placed after the styles (a caller's override, a shared emotion
        // style) would stop winning.
        if (styleArgs.length > 0)
          throw new UnsupportedCssError(`cx: outside class after StyleX: ${text(arg)}`);
        rest.push(text(arg));
      }
    }
    return { rest, styleArgs };
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && text(node.name) === 'className' && node.initializer) {
      const init = node.initializer;
      const expr = ts.isJsxExpression(init) ? init.expression : undefined;
      const element = node.parent.parent as ts.JsxOpeningLikeElement;
      const hasStyle = element.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && text(p.name) === 'style',
      );
      // Spread only onto DOM elements: a component's props may not declare `style`.
      const isIntrinsic = /^[a-z]/.test(text(element.tagName));
      if (expr && !hasStyle && isIntrinsic) {
        if (isStyleArg(expr)) {
          replace(node, `{...stylex.props(${text(expr)})}`);
          return;
        }
        if (isCx(expr)) {
          const { rest, styleArgs } = splitCx(expr);
          if (styleArgs.length > 0 && rest.length === 0) {
            replace(node, `{...stylex.props(${styleArgs.join(', ')})}`);
            return;
          }
        }
      }
    }

    if (isCx(node)) {
      const { rest, styleArgs } = splitCx(node);
      if (styleArgs.length > 0) {
        if (rest.length > 0) mergesOutsideClassName++;
        const props = `stylex.props(${styleArgs.join(', ')}).className`;
        replace(node, `${text(node.expression)}(${[props, ...rest].join(', ')})`);
        return;
      }
    }

    if (isStyleArg(node as ts.Expression) && !isStyleArg(node.parent as ts.Expression)) {
      // A ref kept in a variable or a lookup object is later combined with other
      // classes; separate stylex.props calls would resolve by CSS order, not by
      // argument order. Object values inside JSX props (classNames slots) are fine.
      const inJsxProp = (n: ts.Node): boolean =>
        !!n.parent &&
        (ts.isJsxExpression(n.parent) ||
          ((ts.isObjectLiteralExpression(n.parent) || ts.isPropertyAssignment(n.parent)) &&
            inJsxProp(n.parent)));
      if (
        ts.isVariableDeclaration(node.parent) ||
        (ts.isPropertyAssignment(node.parent) && !inJsxProp(node.parent))
      )
        throw new UnsupportedCssError('style ref stored outside JSX');
      replace(node, `stylex.props(${text(node)}).className`);
      return;
    }

    if (ts.isIdentifier(node) && stylesNames.has(node.text)) {
      const parent = node.parent;
      const isTopLevelDecl =
        ts.isVariableDeclaration(parent) &&
        parent.name === node &&
        ts.isVariableStatement(parent.parent.parent) &&
        parent.parent.parent.parent === sf;
      // A local binding with the same name would make styles.k mean something else.
      if (
        !isTopLevelDecl &&
        ((ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isBindingElement(parent) && parent.name === node) ||
          (ts.isParameter(parent) && parent.name === node))
      )
        throw new UnsupportedCssError('shadowed styles binding');
      // Same spelling, different meaning: JSX attribute, member and key names.
      const isName =
        isTopLevelDecl ||
        (ts.isJsxAttribute(parent) && parent.name === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        ts.isPropertySignature(parent);
      if (!isName) throw new UnsupportedCssError(`styles used as a value: ${text(parent)}`);
    }

    // The rewritten createStaticStyles call is replaced wholesale.
    if (ts.isCallExpression(node) && text(node.expression) === createLocal) return;
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Imports: drop createStaticStyles (and cssVar / responsive when they become
  // StyleX consts), add the StyleX imports. Unused cx is left to eslint --fix.
  const dropped = new Set(['createStaticStyles']);
  if (usesCssVar || outerCssVar) dropped.add('cssVar');
  if (outerResponsive) dropped.add('responsive');
  for (const decl of uiImportDecls) {
    const bindings = decl.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const keep = bindings.elements.filter((el) => !dropped.has((el.propertyName ?? el.name).text));
    if (keep.length === bindings.elements.length) continue;
    const isTypeOnly = decl.importClause?.isTypeOnly ? 'type ' : '';
    replace(
      decl,
      keep.length === 0 && !decl.importClause?.name
        ? ''
        : `import ${isTypeOnly}{ ${keep.map((el) => text(el)).join(', ')} } from '${UI}';`,
    );
  }

  const added = [`import * as stylex from '@stylexjs/stylex';`];
  if (usesCssVar || outerCssVar)
    added.unshift(`import { cssVar } from '${UI}/stylex/cssVar.stylex';`);
  if (usesMedia || outerResponsive)
    added.unshift(`import { media } from '${UI}/stylex/media.stylex';`);
  const anchor = uiImportDecls.at(-1) ?? sf.statements.find(ts.isImportDeclaration);
  const at = anchor ? anchor.getEnd() : 0;
  edits.push({ end: at, start: at, text: `\n${added.join('\n')}\n` });

  // Outside the styles, runtime `responsive.x` was a media query string too.
  let code = applyEdits(source, edits);
  if (outerResponsive && outerResponsive !== 'media')
    code = code.replaceAll(new RegExp(String.raw`\b${outerResponsive}\.`, 'g'), 'media.');

  return { code, mergesOutsideClassName };
};
