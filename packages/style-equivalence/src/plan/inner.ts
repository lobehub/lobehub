import { parseSelectorList, type SelectorNode } from './selectorTree';

export interface InnerNode {
  attributes: Record<string, string>;
  children: InnerNode[];
  tag: string;
}

const VOID_TAGS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'wbr']);
const PSEUDO_ELEMENTS = new Set(['::after', '::before', '::marker', '::placeholder']);
const ATTRIBUTE_OPERATORS = new Set([undefined, '=', '~=', '|=', '^=', '$=', '*=']);

interface Trie {
  attributes: Record<string, string>;
  children: Map<string, Trie>;
  tag: string;
}

interface Step {
  key: string;
  nodes: SelectorNode[];
}

const compoundOf = (nodes: SelectorNode[], last: boolean): Trie | undefined => {
  const node: Trie = { attributes: {}, children: new Map(), tag: 'div' };
  const classes: string[] = [];
  for (const [index, part] of nodes.entries()) {
    const value = part.value ?? '';
    if (part.type === 'tag') node.tag = value.toLowerCase();
    else if (part.type === 'universal') continue;
    else if (part.type === 'class') classes.push(value);
    else if (part.type === 'id') node.attributes.id = value;
    else if (part.type === 'attribute' && part.attribute) {
      if (!ATTRIBUTE_OPERATORS.has(part.operator) || part.attribute in node.attributes)
        return undefined;
      node.attributes[part.attribute] = part.operator ? value : '';
    } else if (part.type === 'pseudo' && value === ':has' && part.nodes?.length === 1) {
      const [argument] = part.nodes;
      const parts = argument.nodes ?? [];
      const [first, ...after] = parts;
      const relative = first?.type === 'combinator';
      const inner = relative ? after : parts;
      if (relative && first.value?.trim() !== '>') return undefined;
      if (!inner.length || inner.some((item) => item.type === 'combinator')) return undefined;
      const child = compoundOf(inner, true);
      if (!child) return undefined;
      node.children.set(`:has(${String(argument).trim()})`, child);
    } else if (part.type === 'pseudo' && PSEUDO_ELEMENTS.has(value)) {
      if (!last || index !== nodes.length - 1) return undefined;
    } else return undefined;
  }
  if (classes.length) node.attributes.className = classes.join(' ');
  return node;
};

const pathOf = (selector: SelectorNode[]) => {
  const steps: Step[] = [];
  let combinator = '';
  let current: SelectorNode[] = [];
  const flush = () => {
    steps.push({ key: `${combinator}${current.map(String).join('').trim()}`, nodes: current });
    current = [];
  };
  for (const part of selector) {
    if (part.type === 'combinator') {
      if (!current.length) return undefined;
      flush();
      combinator = part.value?.trim() || ' ';
      if (![' ', '>'].includes(combinator)) return undefined;
      continue;
    }
    if (part.type === 'nesting' || part.type === 'comment') return undefined;
    current.push(part);
  }
  if (!current.length) return undefined;
  flush();
  return steps;
};

const merge = (into: Map<string, Trie>, steps: Step[]) => {
  let level = into;
  for (const [index, step] of steps.entries()) {
    const fresh = compoundOf(step.nodes, index === steps.length - 1);
    if (!fresh) return false;
    const existing = level.get(step.key) ?? fresh;
    level.set(step.key, existing);
    level = existing.children;
  }
  return true;
};

const finish = (trie: Map<string, Trie>): InnerNode[] | undefined => {
  const nodes: InnerNode[] = [];
  for (const node of trie.values()) {
    const children = finish(node.children);
    if (!children || (children.length && VOID_TAGS.has(node.tag))) return undefined;
    nodes.push({ attributes: node.attributes, children, tag: node.tag });
  }
  return nodes;
};

export const innerTargets = (selectors: string[], scope: string) => {
  const root = new Map<string, Trie>();
  for (const text of selectors) {
    const parsed = parseSelectorList(text);
    if (!parsed) return undefined;
    for (const selector of parsed) {
      const steps = pathOf(selector);
      const [head, ...rest] = steps ?? [];
      const scoped =
        head?.nodes[0]?.type === 'class' &&
        head.nodes[0].value === scope &&
        head.nodes.slice(1).every((part) => part.type === 'pseudo');
      if (!steps || !scoped || (rest.length && !merge(root, rest))) return undefined;
    }
  }
  return finish(root);
};

const hasArguments = (nodes: SelectorNode[], found: SelectorNode[][]) => {
  for (const node of nodes) {
    if (node.type === 'pseudo' && node.value === ':has')
      for (const argument of node.nodes ?? []) found.push(argument.nodes ?? []);
    if (node.nodes) hasArguments(node.nodes, found);
  }
};

export const hasTargets = (selectors: string[]) => {
  const found: SelectorNode[][] = [];
  for (const text of selectors)
    for (const selector of parseSelectorList(text) ?? []) hasArguments(selector, found);
  const targets = new Map<string, InnerNode>();
  for (const parts of found) {
    const [first, ...after] = parts;
    const inner = first?.type === 'combinator' && first.value?.trim() === '>' ? after : parts;
    if (!inner.length || inner.some((item) => item.type === 'combinator')) continue;
    const trie = compoundOf(inner, true);
    const nodes = trie && finish(new Map([['', trie]]));
    if (nodes) for (const node of nodes) targets.set(JSON.stringify(node), node);
  }
  return [...targets.values()];
};
