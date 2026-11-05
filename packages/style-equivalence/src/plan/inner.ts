import selectorParser from 'postcss-selector-parser';

export interface InnerNode {
  attributes: Record<string, string>;
  children: InnerNode[];
  tag: string;
}

type Node = selectorParser.Node;

const VOID_TAGS = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'source', 'wbr']);
const PSEUDO_ELEMENTS = new Set(['::after', '::before', '::marker', '::placeholder']);
const ATTRIBUTE_OPERATORS = new Set([undefined, '=', '~=', '|=', '^=', '$=', '*=']);

interface Trie {
  attributes: Record<string, string>;
  children: Map<string, Trie>;
  tag: string;
}

const compoundOf = (nodes: Node[], last: boolean): Trie | undefined => {
  const node: Trie = { attributes: {}, children: new Map(), tag: 'div' };
  const classes: string[] = [];
  for (const [index, part] of nodes.entries()) {
    if (part.type === 'tag') node.tag = part.value.toLowerCase();
    else if (part.type === 'universal') continue;
    else if (part.type === 'class') classes.push(part.value);
    else if (part.type === 'id') node.attributes.id = part.value;
    else if (part.type === 'attribute') {
      const operator = part.operator as string | undefined;
      if (!ATTRIBUTE_OPERATORS.has(operator) || part.attribute in node.attributes) return undefined;
      node.attributes[part.attribute] = operator ? (part.value ?? '') : '';
    } else if (part.type === 'pseudo' && part.value === ':has' && part.nodes.length === 1) {
      const [first, ...after] = part.nodes[0].nodes;
      const relative = first?.type === 'combinator';
      const inner = relative ? after : part.nodes[0].nodes;
      if (relative && first.value.trim() !== '>') return undefined;
      if (!inner.length || inner.some((item) => item.type === 'combinator')) return undefined;
      const child = compoundOf(inner, true);
      if (!child) return undefined;
      node.children.set(`:has${String(part.nodes[0]).trim()}`, child);
    } else if (part.type === 'pseudo' && PSEUDO_ELEMENTS.has(part.value)) {
      if (!last || index !== nodes.length - 1) return undefined;
    } else return undefined;
  }
  if (classes.length) node.attributes.className = classes.join(' ');
  return node;
};

const pathOf = (selector: selectorParser.Selector) => {
  const steps: Array<{ key: string; nodes: Node[] }> = [];
  let combinator = '';
  let current: Node[] = [];
  const flush = () => {
    steps.push({ key: `${combinator}${current.map(String).join('').trim()}`, nodes: current });
    current = [];
  };
  for (const part of selector.nodes) {
    if (part.type === 'combinator') {
      if (!current.length) return undefined;
      flush();
      combinator = part.value.trim() || ' ';
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

const merge = (into: Map<string, Trie>, steps: Array<{ key: string; nodes: Node[] }>) => {
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
    let valid = true;
    try {
      selectorParser((parsed) => {
        parsed.each((selector) => {
          if (!valid) return;
          const steps = pathOf(selector);
          const [head, ...rest] = steps ?? [];
          const scoped =
            head?.nodes[0]?.type === 'class' &&
            head.nodes[0].value === scope &&
            head.nodes.slice(1).every((part) => part.type === 'pseudo');
          if (!steps || !scoped) valid = false;
          else if (rest.length && !merge(root, rest)) valid = false;
        });
      }).processSync(text);
    } catch {
      return undefined;
    }
    if (!valid) return undefined;
  }
  return finish(root);
};
