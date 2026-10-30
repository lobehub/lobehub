import { createHash } from 'node:crypto';
import path from 'node:path';

import ts from 'typescript';

import { listSourceEntries, readBlobs } from './buildSnapshots';
import { git } from './git';
import type { RevisionSession, ScopeInventory, ScopeUnit } from './types';

const styleFactories = new Set([
  'createStyles',
  'createStaticStyles',
  'create',
  'keyframes',
  'defineVars',
  'createTheme',
]);
const stylePackages = new Set([
  '@lobehub/ui',
  '@stylexjs/stylex',
  'antd-style',
  '@emotion/react',
  '@emotion/css',
]);

/** An inventory, not an equivalence proof: source/binding units stay unresolved. */
export const inventorySource = (
  source: string,
  file: string,
  side: ScopeUnit['side'],
  blobSha: string,
): ScopeUnit[] => {
  const units: ScopeUnit[] = [];
  const extension = path.extname(file);
  const unit = (kind: ScopeUnit['kind'], label: string, start: number, end: number) => {
    units.push({
      blobSha,
      end,
      file,
      id: `${side}:${file}:${kind}:${start}`,
      kind,
      label,
      side,
      start,
    });
  };
  unit(
    extension === '.css' ? 'stylesheet' : /\.[cm]?[jt]sx?$/.test(file) ? 'source' : 'opaque',
    file,
    0,
    source.length,
  );
  if (!/\.[cm]?[jt]sx?$/.test(file)) return units;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const importedFunctions = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of ast.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !stylePackages.has(statement.moduleSpecifier.text)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) continue;
    if (clause?.name && statement.moduleSpecifier.text === '@stylexjs/stylex')
      namespaces.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        if (
          !element.isTypeOnly &&
          styleFactories.has(element.propertyName?.text ?? element.name.text)
        )
          importedFunctions.add(element.name.text);
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isFactory = ts.isIdentifier(callee)
        ? importedFunctions.has(callee.text)
        : ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          namespaces.has(callee.expression.text) &&
          styleFactories.has(callee.name.text);
      if (isFactory) {
        unit('style-slot', callee.getText(ast), node.getStart(ast), node.end);
        const visitSlots = (child: ts.Node) => {
          if (ts.isObjectLiteralExpression(child)) {
            for (const property of child.properties) {
              if (ts.isPropertyAssignment(property))
                unit(
                  'style-slot',
                  property.name.getText(ast),
                  property.getStart(ast),
                  property.end,
                );
              else unit('style-slot', 'dynamic-slot', property.getStart(ast), property.end);
            }
          } else ts.forEachChild(child, visitSlots);
        };
        node.arguments.forEach(visitSlots);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return units;
};

export const inventoryScope = async (session: RevisionSession): Promise<ScopeInventory> => {
  // Disable rename similarity heuristics: deletion/addition cannot disappear from scope.
  const tokens = (
    await git(session.directory, [
      'diff',
      '--name-status',
      '--no-renames',
      '-z',
      session.identity.baseSha,
      session.identity.candidateTreeSha,
    ])
  )
    .toString()
    .split('\0')
    .filter(Boolean);
  const changedFiles: ScopeInventory['changedFiles'] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const status = tokens[index];
    const file = tokens[index + 1];
    if (!file || !['A', 'D', 'M', 'T'].includes(status))
      throw new Error('UNSUPPORTED_GIT_DIFF_STATUS');
    changedFiles.push({
      after: status === 'D' ? undefined : file,
      before: status === 'A' ? undefined : file,
      status,
    });
  }
  const units: ScopeUnit[] = [];
  for (const side of ['base', 'candidate'] as const) {
    const files = new Set(
      changedFiles.map((entry) => (side === 'base' ? entry.before : entry.after)).filter(Boolean),
    );
    const entries = (
      await listSourceEntries(
        session.directory,
        side === 'base' ? session.identity.baseSha : session.identity.candidateTreeSha,
      )
    ).filter((entry) => files.has(entry.path));
    for (const entry of entries) {
      if (entry.bytes > 4 * 1024 ** 2 || entry.type !== 'blob') {
        units.push({
          blobSha: entry.oid,
          end: entry.bytes,
          file: entry.path,
          id: `${side}:${entry.path}:opaque:0`,
          kind: 'opaque',
          label: entry.path,
          side,
          start: 0,
        });
      } else {
        const [blob] = await readBlobs(session.directory, [entry]);
        units.push(...inventorySource(blob.toString(), entry.path, side, entry.oid));
      }
    }
  }
  const limitations = changedFiles.length
    ? [
        'TRANSITIVE_IMPACT_UNPROVEN',
        'SOURCE_BINDING_UNPROVEN',
        'CONDITION_PARTITIONS_UNPLANNED',
        'PURE_STYLE_MIGRATION_UNPROVEN',
      ]
    : [];
  const hash = createHash('sha256')
    .update(JSON.stringify({ changedFiles, limitations, units }))
    .digest('hex');
  return { changedFiles, hash, limitations, units };
};
