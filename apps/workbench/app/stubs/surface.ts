const EXPORT_CONST = /^[ \t]*export const (\w+)\s*=\s*/gm;
const EXPORT_NAMED = /^[ \t]*export \{([^}]+)\}/gm;
const EXPORT_FUNCTION = /^[ \t]*export (?:async )?function (\w+)/gm;
const ASSIGN_MEMBER = /^[ \t]*(\w+)\.(\w+)\s*=/gm;
const EMPTY_STATE = /(?:const|let)\s+emptyState\s*=\s*\{([^}]*)\}/;
const OPEN_INITIALIZER = /^(?:reject\s*\(|createTRPCClient\b)/;

export type StubSurface = {
  exports: Set<string>;
  members: Map<string, Set<string>>;
  open: Set<string>;
};

export type StubUsage = {
  members: Map<string, Set<string>>;
  names: Set<string>;
};

const addMember = (members: Map<string, Set<string>>, name: string, member: string) => {
  if (!members.has(name)) members.set(name, new Set());
  members.get(name)!.add(member);
};

const parseObjectKeys = (body: string): Set<string> => {
  const keys = new Set<string>();
  for (const match of body.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:[:(,]|$)/gm)) {
    keys.add(match[1]!);
  }
  return keys;
};

const parseNamedSpecifiers = (clause: string): Array<{ imported: string; local: string }> => {
  const specifiers: Array<{ imported: string; local: string }> = [];
  for (const raw of clause.split(',')) {
    const piece = raw.trim();
    if (!piece || piece === ',') continue;
    const typeOnly = /^type\s+/.test(piece);
    const rest = piece.replace(/^type\s+/, '');
    if (!rest || rest === 'type') continue;
    const aliased = rest.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (aliased) {
      if (typeOnly) continue;
      specifiers.push({ imported: aliased[1]!, local: aliased[2]! });
      continue;
    }
    const ident = rest.match(/^([A-Z_$][\w$]*)$/i);
    if (!ident || typeOnly) continue;
    specifiers.push({ imported: ident[1]!, local: ident[1]! });
  }
  return specifiers;
};

export const parseStubSurface = (source: string): StubSurface => {
  const exports = new Set<string>();
  const members = new Map<string, Set<string>>();
  const open = new Set<string>();

  for (const match of source.matchAll(EXPORT_CONST)) {
    const name = match[1]!;
    exports.add(name);
    const rhs = source.slice(match.index! + match[0].length).trimStart();
    if (OPEN_INITIALIZER.test(rhs)) {
      open.add(name);
      continue;
    }
    if (rhs.startsWith('{')) {
      const close = rhs.indexOf('}');
      if (close !== -1) {
        members.set(name, parseObjectKeys(rhs.slice(1, close)));
      }
    }
  }

  for (const match of source.matchAll(EXPORT_FUNCTION)) exports.add(match[1]!);

  for (const match of source.matchAll(EXPORT_NAMED)) {
    for (const spec of parseNamedSpecifiers(match[1]!)) exports.add(spec.imported);
  }

  for (const match of source.matchAll(ASSIGN_MEMBER)) {
    addMember(members, match[1]!, match[2]!);
  }

  const emptyState = source.match(EMPTY_STATE);
  if (emptyState) {
    const keys = parseObjectKeys(emptyState[1]!);
    for (const name of exports) {
      if (open.has(name) || !/^(?:use\w+Store|get\w+StoreState)$/.test(name)) continue;
      for (const key of keys) addMember(members, name, key);
    }
  }

  return { exports, members, open };
};

const collectNamespaceUsage = (source: string, local: string, usage: StubUsage) => {
  const access = new RegExp(
    String.raw`\b${local}\.([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?`,
    'g',
  );
  for (const match of source.matchAll(access)) {
    const exported = match[1]!;
    usage.names.add(exported);
    if (match[2]) addMember(usage.members, exported, match[2]);
  }
};

const collectLocalMembers = (source: string, local: string, exported: string, usage: StubUsage) => {
  const dotted = new RegExp(String.raw`\b${local}\.([A-Za-z_$][\w$]*)`, 'g');
  for (const match of source.matchAll(dotted)) addMember(usage.members, exported, match[1]!);

  const returned = new RegExp(String.raw`\b${local}\(\)\.([A-Za-z_$][\w$]*)`, 'g');
  for (const match of source.matchAll(returned)) addMember(usage.members, exported, match[1]!);

  const selector = new RegExp(
    String.raw`\b${local}\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)=]*)?\)?\s*=>`,
    'g',
  );
  for (const match of source.matchAll(selector)) {
    const param = match[1]!;
    const window = source.slice(
      match.index! + match[0].length,
      match.index! + match[0].length + 400,
    );
    const props = new RegExp(String.raw`\b${param}\.([A-Za-z_$][\w$]*)`, 'g');
    for (const prop of window.matchAll(props)) addMember(usage.members, exported, prop[1]!);
  }
};

const consumeImportClause = (source: string, clause: string, usage: StubUsage) => {
  const trimmed = clause.trim();
  const namespace = trimmed.match(/^(?:(\w+)\s*,\s*)?\*\s+as\s+(\w+)$/);
  if (namespace) {
    if (namespace[1]) {
      usage.names.add('default');
      collectLocalMembers(source, namespace[1], 'default', usage);
    }
    collectNamespaceUsage(source, namespace[2]!, usage);
    return;
  }

  const named = trimmed.match(/^(?:(\w+)\s*,\s*)?\{([^}]*)\}$/);
  if (named) {
    if (named[1]) {
      usage.names.add('default');
      collectLocalMembers(source, named[1], 'default', usage);
    }
    for (const spec of parseNamedSpecifiers(named[2] ?? '')) {
      usage.names.add(spec.imported);
      collectLocalMembers(source, spec.local, spec.imported, usage);
    }
    return;
  }

  const defaultOnly = trimmed.match(/^(\w+)$/);
  if (defaultOnly) {
    usage.names.add('default');
    collectLocalMembers(source, defaultOnly[1]!, 'default', usage);
  }
};

export const collectStubUsage = (source: string, specifier: string): StubUsage | null => {
  const usage: StubUsage = { members: new Map(), names: new Set() };
  let matched = false;

  for (const quote of [`'${specifier}'`, `"${specifier}"`]) {
    const needle = `from ${quote}`;
    let cursor = 0;
    while (cursor < source.length) {
      const idx = source.indexOf(needle, cursor);
      if (idx === -1) break;
      cursor = idx + needle.length;
      const before = source.slice(Math.max(0, idx - 400), idx);
      const importIdx = Math.max(before.lastIndexOf('import'), before.lastIndexOf('export'));
      if (importIdx === -1) continue;
      matched = true;
      const raw = before.slice(importIdx).replace(/^(?:import|export)\s+/, '');
      if (raw.startsWith('type ')) continue;
      consumeImportClause(source, raw.trim(), usage);
    }
  }

  return matched ? usage : null;
};

export const stubUsageGaps = (surface: StubSurface, usage: StubUsage): string[] => {
  const gaps: string[] = [];

  for (const name of usage.names) {
    if (!surface.exports.has(name)) gaps.push(name);
  }

  for (const [name, members] of usage.members) {
    if (!usage.names.has(name) || !surface.exports.has(name) || surface.open.has(name)) continue;
    const implemented = surface.members.get(name) ?? new Set();
    for (const member of members) {
      if (!implemented.has(member)) gaps.push(`${name}.${member}`);
    }
  }

  return gaps.sort();
};

export const reportStubSurfaceGaps = (
  files: Array<{ rel: string; source: string }>,
  stubs: Array<{ source: string; specifier: string }>,
): string[] => {
  const surfaces = stubs.map((stub) => ({
    specifier: stub.specifier,
    surface: parseStubSurface(stub.source),
  }));

  const lines: string[] = [];
  for (const file of files) {
    for (const stub of surfaces) {
      const usage = collectStubUsage(file.source, stub.specifier);
      if (!usage) continue;
      const gaps = stubUsageGaps(stub.surface, usage);
      if (gaps.length === 0) continue;
      lines.push(`  ${file.rel}\n    ${stub.specifier}: ${gaps.join(', ')}`);
    }
  }
  return lines;
};
