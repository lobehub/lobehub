const name = (node) => node?.name ?? node?.value;
const positions = new Set(['start', 'end', 'loc', 'raw']);
const bindingNames = (pattern) => {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
  if (pattern.type === 'ObjectPattern')
    return pattern.properties.flatMap((item) =>
      bindingNames(item.type === 'RestElement' ? item.argument : item.value),
    );
  return [];
};

// Keep tree-shaking directives: moving a PURE annotation can change runtime behavior.
export function parseModule(code, id, parseSync) {
  const { program, comments, errors } = parseSync(id, code);
  if (errors.length) throw new Error(`Cannot parse main hash module ${id}: ${errors[0].message}`);
  const nodes = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.type === 'string') nodes.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(program);
  const annotations = new Map();
  for (const comment of comments) {
    if (!/[@#]__(?:PURE|NO_SIDE_EFFECTS)__|@vite-/.test(comment.value)) continue;
    const start = Math.min(
      ...nodes.filter((node) => node.start >= comment.end).map((node) => node.start),
    );
    const target = Number.isFinite(start) ? start : program.start;
    annotations.set(target, [...(annotations.get(target) ?? []), comment.value.trim()]);
  }
  return JSON.parse(
    JSON.stringify(program, (key, value) => {
      if (positions.has(key)) return undefined;
      if (typeof value === 'bigint') return String(value);
      if (value?.type && annotations.has(value.start)) {
        return { ...value, annotations: annotations.get(value.start) };
      }
      return value;
    }),
  );
}

export function moduleRequests(ast) {
  const requests = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
      requests.add(node.source.value);
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.name === 'require' &&
      node.arguments?.[0]?.type === 'Literal' &&
      typeof node.arguments[0].value === 'string'
    ) {
      requests.add(node.arguments[0].value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return [...requests];
}

export function walkGraph(nodes, starts, stops = new Set()) {
  const seen = new Set();
  const pending = [...starts];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id) || stops.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (node) pending.push(...node.imports, ...node.dynamicImports);
  }
  return seen;
}

const pureExpression = (node) =>
  !node || ['Literal', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
const hasOwnEffects = (ast) =>
  ast.body.some((statement) => {
    if (
      [
        'ImportDeclaration',
        'ExportAllDeclaration',
        'EmptyStatement',
        'FunctionDeclaration',
      ].includes(statement.type)
    )
      return false;
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (!declaration || declaration.type === 'FunctionDeclaration') return false;
    if (declaration.type === 'VariableDeclaration')
      return declaration.declarations.some((item) => !pureExpression(item.init));
    return true;
  });

const namespaceReads = (ast, local) => {
  const names = new Set();
  let escapes = false;
  const visit = (node, parent, grandparent) => {
    if (!node || typeof node !== 'object' || node.type === 'ImportDeclaration') return;
    if (node.type === 'Identifier' && node.name === local) {
      const member = parent?.type === 'MemberExpression' && parent.object === node;
      const property =
        member &&
        (!parent.computed
          ? name(parent.property)
          : parent.property.type === 'Literal'
            ? parent.property.value
            : undefined);
      // Calling ns.method() exposes the entire namespace through `this`.
      if (
        typeof property !== 'string' ||
        (grandparent?.type === 'CallExpression' && grandparent.callee === parent) ||
        (grandparent?.type === 'TaggedTemplateExpression' && grandparent.tag === parent)
      )
        escapes = true;
      else names.add(property);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((item) => visit(item, node, parent));
      else if (child && typeof child === 'object') visit(child, node, parent);
    }
  };
  visit(ast);
  return escapes ? undefined : [...names].sort();
};

/**
 * Resolve forwarding modules even when Rolldown omitted them from chunk.modules.
 * Unsupported/cyclic bindings retain their source closure instead of assuming equality.
 */
export function createModuleRecord(node, { nodes, identity, opaque, seen = new Set() }) {
  if (seen.has(node.id)) {
    return {
      cycle: Object.fromEntries(
        [...walkGraph(nodes, [node.id])]
          .filter((id) => !opaque(id) && nodes.get(id)?.ast)
          .sort()
          .map((id) => [identity(id), nodes.get(id).ast]),
      ),
    };
  }
  seen = new Set([...seen, node.id]);
  const seenFallbacks = new Set();
  const inlinedSources = new Set();
  const terminal = (id, local) => {
    // Constant folding can remove the contributing module from chunk.modules entirely.
    if (!nodes.get(id)?.retained) inlinedSources.add(id);
    return { module: identity(id), local };
  };
  const fallback = (id) => {
    const files = [...walkGraph(nodes, [id])].filter(
      (item) => !opaque(item) && nodes.get(item)?.ast,
    );
    for (const file of files) seenFallbacks.add(file);
    return { fallback: identity(id) };
  };
  const request = (from, source) => {
    const resolution = nodes.get(from)?.resolutions[source];
    if (!resolution) throw new Error(`Unresolved main hash binding ${source} in ${from}`);
    return resolution;
  };
  const exportNames = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen = new Set([...seen, id]);
    const names = new Set();
    for (const statement of nodes.get(id)?.ast?.body ?? []) {
      if (statement.type === 'ExportDefaultDeclaration') names.add('default');
      if (statement.type === 'ExportNamedDeclaration') {
        for (const specifier of statement.specifiers) names.add(name(specifier.exported));
        for (const binding of bindingNames(statement.declaration?.id)) names.add(binding);
        for (const item of statement.declaration?.declarations ?? []) {
          for (const binding of bindingNames(item.id)) names.add(binding);
        }
      }
      if (statement.type === 'ExportAllDeclaration') {
        if (statement.exported) names.add(name(statement.exported));
        else {
          const child = request(id, statement.source.value);
          if (!opaque(child))
            for (const binding of exportNames(child, seen)) {
              if (binding !== 'default') names.add(binding);
            }
        }
      }
    }
    return [...names].sort();
  };
  const imported = (from, source, exported, seen) => {
    const id = request(from, source);
    // Use the import spelling at package boundaries, not bundled/external IDs.
    if (opaque(id)) return { module: opaque(id, source), exported };
    return resolve(id, exported, seen);
  };
  const local = (id, binding, seen) => {
    for (const statement of nodes.get(id)?.ast?.body ?? []) {
      if (statement.type !== 'ImportDeclaration') continue;
      const specifier = statement.specifiers.find((item) => name(item.local) === binding);
      if (specifier)
        return imported(
          id,
          statement.source.value,
          specifier.type === 'ImportNamespaceSpecifier'
            ? '*'
            : specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : name(specifier.imported),
          seen,
        );
    }
    return terminal(id, binding);
  };
  const resolve = (id, exported, seen = new Set()) => {
    const key = `${id}\0${exported}`;
    if (seen.has(key)) return fallback(id);
    seen = new Set([...seen, key]);
    const target = nodes.get(id);
    if (!target?.ast) return fallback(id);
    if (exported === '*') {
      if (
        target.ast.body.some(
          (item) =>
            item.type === 'ExportAllDeclaration' &&
            !item.exported &&
            opaque(request(id, item.source.value)),
        )
      )
        return fallback(id);
      const names = exportNames(id);
      if (!names.length && target.inputFormat === 'cjs') return fallback(id);
      return {
        namespace: Object.fromEntries(names.map((item) => [item, resolve(id, item, seen)])),
      };
    }
    for (const statement of target.ast.body) {
      if (exported === 'default' && statement.type === 'ExportDefaultDeclaration') {
        // A default expression is a value snapshot, unlike a live export specifier.
        return target.retained ? { module: identity(id), exported } : fallback(id);
      }
      if (statement.type === 'ExportAllDeclaration' && name(statement.exported) === exported) {
        return imported(id, statement.source.value, '*', seen);
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const specifier = statement.specifiers.find((item) => name(item.exported) === exported);
      if (specifier)
        return statement.source
          ? imported(id, statement.source.value, name(specifier.local), seen)
          : local(id, name(specifier.local), seen);
      const declaration = statement.declaration;
      if (
        bindingNames(declaration?.id).includes(exported) ||
        declaration?.declarations?.some((item) => bindingNames(item.id).includes(exported))
      ) {
        return terminal(id, exported);
      }
    }
    if (exported !== 'default') {
      const matches = [];
      for (const statement of target.ast.body) {
        if (statement.type !== 'ExportAllDeclaration' || statement.exported) continue;
        const child = request(id, statement.source.value);
        if (opaque(child)) return fallback(id);
        if (exportNames(child).includes(exported)) matches.push(resolve(child, exported, seen));
      }
      const unique = [...new Map(matches.map((item) => [JSON.stringify(item), item])).values()];
      if (unique.length === 1) return unique[0];
    }
    return fallback(id);
  };
  const effects = (id, seen = new Set()) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const target = nodes.get(id);
    if (!target?.ast) return [];
    const result = [];
    for (const statement of target.ast.body) {
      if (
        !statement.source ||
        !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          statement.type,
        )
      )
        continue;
      const child = request(id, statement.source.value);
      if (opaque(child)) result.push(opaque(child, statement.source.value));
      else result.push(...effects(child, seen));
    }
    if (target.retained && hasOwnEffects(target.ast)) result.push(identity(id));
    return [...new Set(result)];
  };
  const bindings = [];
  for (const statement of node.ast.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    for (const specifier of statement.specifiers) {
      const selected =
        specifier.type === 'ImportNamespaceSpecifier'
          ? namespaceReads(node.ast, name(specifier.local))
          : undefined;
      bindings.push({
        local: name(specifier.local),
        origin: selected
          ? {
              namespace: Object.fromEntries(
                selected.map((item) => [item, imported(node.id, statement.source.value, item)]),
              ),
            }
          : imported(
              node.id,
              statement.source.value,
              specifier.type === 'ImportNamespaceSpecifier'
                ? '*'
                : specifier.type === 'ImportDefaultSpecifier'
                  ? 'default'
                  : name(specifier.imported),
            ),
      });
    }
  }
  const dynamicBindings = node.dynamicImports.map((id) => {
    const source =
      Object.keys(node.resolutions).find((key) => node.resolutions[key] === id) ?? identity(id);
    return opaque(id) ? { module: opaque(id, source) } : resolve(id, '*');
  });
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ImportExpression' && typeof value.source?.value === 'string') {
      dynamicBindings.push(imported(node.id, value.source.value, '*'));
    }
    if (
      value.type === 'CallExpression' &&
      value.callee?.name === 'require' &&
      typeof value.arguments?.[0]?.value === 'string'
    ) {
      const source = value.arguments[0].value;
      const child = request(node.id, source);
      dynamicBindings.push(opaque(child) ? { module: opaque(child, source) } : fallback(child));
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(node.ast);
  const exports = node.entry ? resolve(node.id, '*') : undefined;
  return {
    code: node.ast,
    bindings,
    dynamicBindings,
    effects: effects(node.id),
    exports,
    inlined: Object.fromEntries(
      [...inlinedSources]
        .sort()
        .map((id) => [
          identity(id),
          createModuleRecord(nodes.get(id), { nodes, identity, opaque, seen }),
        ]),
    ),
    fallback: Object.fromEntries(
      [...seenFallbacks].sort().map((id) => [identity(id), nodes.get(id).ast]),
    ),
  };
}
