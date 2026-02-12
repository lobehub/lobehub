import debug from 'debug';
import { type Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

// 创建 debugger 实例
const log = debug('lobe-markdown:remark-plugin:self-closing');

const escapeRegExp = (str: string) => str.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

// Regex to parse attributes from a string
// Handles keys, keys with quoted values (double or single), and boolean keys
const attributeRegex = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// Helper function to parse the attribute string into an object
const parseAttributes = (attributeString: string): Record<string, string | boolean> => {
  const attributes: Record<string, string | boolean> = {};
  let match;
  while ((match = attributeRegex.exec(attributeString)) !== null) {
    const [, key, valueDouble, valueSingle, valueUnquoted] = match;
    // If any value group is captured, use it, otherwise treat as boolean true
    attributes[key] = valueDouble ?? valueSingle ?? valueUnquoted ?? true;
  }
  return attributes;
};

export const createRemarkSelfClosingTagPlugin =
  (tagName: string): Plugin<[], any> =>
  () => {
    // Regex for the specific tag, ensure it matches the entire string for HTML check
    // Allow trailing whitespace after /> to handle cases where markdown parsers include it
    // Tag names are case-insensitive in HTML, and some upstream processors may normalize casing.
    const escapedTagName = escapeRegExp(tagName);
    const exactTagRegex = new RegExp(`^<${escapedTagName}(\\s+[^>]*?)?\\s*\\/>\\s*$`, 'i');
    // Regex for finding tags within text
    const textTagRegex = new RegExp(`<${escapedTagName}(\\s+[^>]*?)?\\s*\\/>`, 'gi');

    return (tree) => {
      // --- DEBUG LOG START (Before Visit) ---
      log('Plugin execution start for tag: %s', tagName);
      log('Tree: %o', tree);
      log('Tree type: %s', tree?.type);
      log('Tree children count: %d', tree?.children?.length);
      if (!tree || !Array.isArray(tree.children)) {
        log('ERROR: Invalid Tree Structure Detected Before Visit! %o', tree);
      } else {
        const hasUndefinedChild = tree.children.includes(undefined);
        if (hasUndefinedChild) {
          log('ERROR: Tree contains undefined children Before Visit!');
          log(
            'Children types: %o',
            tree.children.map((c: any) => c?.type),
          );
        }
      }
      log('---------------------------------------------------');
      // --- DEBUG LOG END (Before Visit) ---

      // 1. Visit HTML nodes first for exact matches
      // @ts-ignore
      visit(tree, 'html', (node, index: number, parent) => {
        log('>>> Visiting HTML node: %s', node.value);
        const match = node.value.match(exactTagRegex);

        if (match && parent && typeof index === 'number') {
          const [, attributesString] = match;
          const properties = attributesString ? parseAttributes(attributesString.trim()) : {};

          const newNode = {
            data: {
              hName: tagName,
              hProperties: properties,
            },
            type: tagName,
          };

          log('Replacing HTML node at index %d with %s node: %o', index, tagName, newNode);
          parent.children.splice(index, 1, newNode);
          return [SKIP, index + 1]; // Skip the node we just inserted
        }

        // Handle the common case where remark parses multiple consecutive HTML tags as a single `html` node
        // e.g.
        // <localFile ... />
        // <localFile ... />
        if (
          parent &&
          typeof index === 'number' &&
          typeof node.value === 'string' &&
          node.value.toLowerCase().includes(`<${tagName.toLowerCase()}`)
        ) {
          const html = node.value;
          const newChildren: any[] = [];
          let lastIndex = 0;
          let textMatch: RegExpExecArray | null;

          textTagRegex.lastIndex = 0;
          while ((textMatch = textTagRegex.exec(html)) !== null) {
            const [fullMatch, attributesString] = textMatch;
            const matchIndex = textMatch.index;

            // Preserve any non-tag fragments as `html` nodes (flow content), so we don't create invalid root-level `text`.
            if (matchIndex > lastIndex) {
              const fragment = html.slice(lastIndex, matchIndex);
              if (fragment) newChildren.push({ type: 'html', value: fragment });
            }

            const properties = attributesString ? parseAttributes(attributesString.trim()) : {};
            newChildren.push({
              data: { hName: tagName, hProperties: properties },
              type: tagName,
            });

            lastIndex = matchIndex + fullMatch.length;
          }

          if (newChildren.length > 0) {
            if (lastIndex < html.length) {
              const fragment = html.slice(lastIndex);
              if (fragment) newChildren.push({ type: 'html', value: fragment });
            }

            // Only replace when we actually produced at least one tag node
            if (newChildren.some((n) => n?.type === tagName)) {
              parent.children.splice(index, 1, ...newChildren);
              return [SKIP, index + newChildren.length];
            }
          }
        }
      });

      // 2. Visit Text nodes for inline matches
      // @ts-ignore
      visit(tree, 'text', (node: any, index: number, parent) => {
        log('>>> Visiting Text node: "%s"', node.value);

        if (
          !parent ||
          typeof index !== 'number' ||
          typeof node.value !== 'string' ||
          !node.value.toLowerCase().includes(`<${tagName.toLowerCase()}`)
        ) {
          return; // Quick exit if tag isn't possibly present
        }

        const text = node.value;
        let lastIndex = 0;
        const newChildren = [];
        let match;

        textTagRegex.lastIndex = 0; // Reset regex state

        while ((match = textTagRegex.exec(text)) !== null) {
          const [fullMatch, attributesString] = match;
          const matchIndex = match.index;

          // Add text before the match
          if (matchIndex > lastIndex) {
            newChildren.push({ type: 'text', value: text.slice(lastIndex, matchIndex) });
          }

          // Parse attributes and create the new node
          const properties = attributesString ? parseAttributes(attributesString.trim()) : {};
          newChildren.push({
            data: {
              hName: tagName,
              hProperties: properties,
            },
            type: tagName,
          });

          lastIndex = matchIndex + fullMatch.length;
        }

        // If matches were found, replace the original text node
        if (newChildren.length > 0) {
          // Add any remaining text after the last match
          if (lastIndex < text.length) {
            newChildren.push({ type: 'text', value: text.slice(lastIndex) });
          }

          // --- DEBUG LOG START (Before Splice - Text Node) ---
          log('--- Replacing Text Node Content ---');
          log('Original text node index: %d', index);
          log('-----------------------------------');
          // --- DEBUG LOG END (Before Splice - Text Node) ---

          parent.children.splice(index, 1, ...newChildren);
          return [SKIP, index + newChildren.length]; // Skip new nodes
        }
      });

      // 3. Visit inlineCode nodes (backtick-wrapped tags like `<localFile ... />`)
      // @ts-ignore
      visit(tree, 'inlineCode', (node: any, index: number, parent) => {
        log('>>> Visiting inlineCode node: "%s"', node.value);

        if (
          !parent ||
          typeof index !== 'number' ||
          typeof node.value !== 'string' ||
          !node.value.toLowerCase().includes(`<${tagName.toLowerCase()}`)
        ) {
          return;
        }

        const match = node.value.match(exactTagRegex);
        if (match) {
          const [, attributesString] = match;
          const properties = attributesString ? parseAttributes(attributesString.trim()) : {};

          const newNode = {
            data: {
              hName: tagName,
              hProperties: properties,
            },
            type: tagName,
          };

          log('Replacing inlineCode node at index %d with %s node: %o', index, tagName, newNode);
          parent.children.splice(index, 1, newNode);
          return [SKIP, index + 1];
        }
      });
    };
  };
