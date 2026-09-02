import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { parseAst, type Plugin } from 'vite';

const RUNTIME_ID = 'virtual:lobe-static-styles-runtime';
const RESOLVED_RUNTIME_ID = `\0${RUNTIME_ID}`;
const HELPER = '__lobeStaticStyle';

interface AntdStyleEvaluator {
  cache: {
    inserted: Record<string, string | true>;
    key: string;
  };
  createStaticStyles: (fn: (utils: unknown) => Record<string, unknown>) => Record<string, unknown>;
  cssVar: unknown;
  responsive: unknown;
}

type Node = { end: number; start: number; type: string } & Record<string, any>;

const STATIC_UTILS = new Set(['cssVar', 'responsive']);

// Safari still needs -webkit- for these; everything else stylis' prefixer adds targets browsers we no longer ship to.
const WEBKIT_ONLY_PROPS = new Set([
  'user-select',
  'backdrop-filter',
  'hyphens',
  'box-decoration-break',
  'text-size-adjust',
]);

const safariPrefixer = (element: {
  props: unknown;
  return?: string;
  type: string;
  value: string;
}) => {
  if (element.type === 'decl' && WEBKIT_ONLY_PROPS.has(element.props as string)) {
    element.return = `-webkit-${element.value}${element.value}`;
  }
};

export const splitRules = (css: string) => {
  const rules: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      rules.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (depth !== 0 || start !== css.length) throw new Error('unbalanced css');
  return rules;
};

const walk = (
  node: Node,
  visit: (node: Node, parent: Node | undefined) => boolean | void,
  parent?: Node,
) => {
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value)
        if (child && typeof child.type === 'string') walk(child, visit, node);
    } else if (value && typeof value.type === 'string') walk(value, visit, node);
  }
};

const isFunctionNode = (type: string) =>
  type === 'FunctionDeclaration' ||
  type === 'FunctionExpression' ||
  type === 'ArrowFunctionExpression';

const collectAntdStyleImports = (program: Node) => {
  const locals = new Map<string, string>();
  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'antd-style') continue;
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type === 'ImportSpecifier')
        locals.set(specifier.local.name, specifier.imported.name);
    }
  }
  return locals;
};

const collectPatternNames = (pattern: Node, into: Set<string>) => {
  if (pattern.type === 'Identifier') into.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties as Node[]) {
      collectPatternNames(
        property.type === 'RestElement' ? property.argument : property.value,
        into,
      );
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements as Node[])
      if (element) collectPatternNames(element, into);
  } else if (pattern.type === 'AssignmentPattern') collectPatternNames(pattern.left, into);
  else if (pattern.type === 'RestElement') collectPatternNames(pattern.argument, into);
};

const isPureCallback = (callback: Node, staticImports: Set<string>) => {
  const bound = new Set<string>(staticImports);
  for (const param of callback.params as Node[]) collectPatternNames(param, bound);
  walk(callback.body, (node) => {
    if (node.type === 'VariableDeclarator') collectPatternNames(node.id, bound);
    else if (isFunctionNode(node.type)) {
      if (node.id) bound.add(node.id.name);
      for (const param of node.params as Node[]) collectPatternNames(param, bound);
    }
  });

  let pure = true;
  walk(callback.body, (node, parent) => {
    if (!pure) return false;
    if (node.type !== 'Identifier') return;
    if (
      parent?.type === 'Property' &&
      !parent.computed &&
      parent.key === node &&
      parent.value !== node
    )
      return;
    if (parent?.type === 'MemberExpression' && !parent.computed && parent.property === node) return;
    if (!bound.has(node.name)) pure = false;
  });
  return pure;
};

const findTopLevelCalls = (program: Node, calleeName: string) => {
  const calls: Node[] = [];
  walk(program, (node) => {
    if (isFunctionNode(node.type)) return false;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === calleeName &&
      node.arguments.length === 1 &&
      isFunctionNode(node.arguments[0].type)
    ) {
      calls.push(node);
      return false;
    }
  });
  return calls;
};

const evaluate = (
  callbackSource: string,
  staticLocals: Map<string, string>,
  evaluator: AntdStyleEvaluator,
) => {
  const names = [...staticLocals.keys()];
  const values = names.map((name) => evaluator[staticLocals.get(name) as 'cssVar' | 'responsive']);

  const factory = new Function(...names, `return (${callbackSource});`)(...values);
  return evaluator.createStaticStyles(factory);
};

const serializeStyles = (result: Record<string, unknown>, evaluator: AntdStyleEvaluator) => {
  const prefix = `${evaluator.cache.key}-`;
  const entries: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) return;
    const css = evaluator.cache.inserted[value.slice(prefix.length)];
    if (typeof css !== 'string') return;
    entries.push(
      `${JSON.stringify(key)}: ${HELPER}(${JSON.stringify(value)}, ${JSON.stringify(splitRules(css))})`,
    );
  }
  return `({ ${entries.join(', ')} })`;
};

export const precompileStaticStyles = (code: string, evaluator: AntdStyleEvaluator) => {
  if (!code.includes('createStaticStyles')) return;
  let program: Node;
  try {
    program = parseAst(code) as unknown as Node;
  } catch {
    return;
  }

  const antdImports = collectAntdStyleImports(program);
  const calleeName = [...antdImports].find(
    ([, imported]) => imported === 'createStaticStyles',
  )?.[0];
  if (!calleeName) return;
  const staticLocals = new Map(
    [...antdImports].filter(([, imported]) => STATIC_UTILS.has(imported)),
  );
  const staticNames = new Set(staticLocals.keys());

  const replacements: Array<{ end: number; start: number; text: string }> = [];
  for (const call of findTopLevelCalls(program, calleeName)) {
    const callback = call.arguments[0] as Node;
    if (!isPureCallback(callback, staticNames)) continue;
    let compiled: string | undefined;
    try {
      compiled = serializeStyles(
        evaluate(code.slice(callback.start, callback.end), staticLocals, evaluator),
        evaluator,
      );
    } catch {
      continue;
    }
    if (compiled) replacements.push({ end: call.end, start: call.start, text: compiled });
  }
  if (replacements.length === 0) return;

  let output = code;
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return `import { insertPrecompiledStyle as ${HELPER} } from '${RUNTIME_ID}';\n${output}`;
};

export const loadAntdStyleEvaluator = async (): Promise<AntdStyleEvaluator> => {
  const mod = await import('antd-style');
  const api = ((mod as any).default?.createStaticStylesFactory ? (mod as any).default : mod) as any;
  const antdStyleRequire = createRequire(
    createRequire(import.meta.url).resolve('antd-style/package.json'),
  );
  const createEmotionModule = antdStyleRequire('@emotion/css/create-instance');
  const createEmotion = createEmotionModule.default ?? createEmotionModule;
  const emotion = createEmotion({
    key: api.styleManager.cache.key,
    stylisPlugins: [safariPrefixer],
  });
  const { createStaticStyles, cssVar, responsive } = api.createStaticStylesFactory({
    cache: emotion.cache,
  });
  return { cache: emotion.cache, createStaticStyles, cssVar, responsive };
};

export function viteStaticStylesPrecompile(): Plugin {
  let evaluator: Promise<AntdStyleEvaluator> | undefined;
  return {
    apply: 'build',
    enforce: 'post',
    load(id) {
      if (id !== RESOLVED_RUNTIME_ID) return;
      return readFileSync(
        fileURLToPath(new URL('staticStylesRuntime.js', import.meta.url)),
        'utf8',
      );
    },
    name: 'lobe-static-styles-precompile',
    resolveId(id) {
      if (id === RUNTIME_ID) return RESOLVED_RUNTIME_ID;
    },
    async transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id.split('?')[0])) return;
      if (id.includes('node_modules') && !id.includes('/node_modules/@lobehub/ui/')) return;
      if (!code.includes('createStaticStyles')) return;
      evaluator ??= loadAntdStyleEvaluator();
      const output = precompileStaticStyles(code, await evaluator);
      if (output) return { code: output, map: null };
    },
  };
}
