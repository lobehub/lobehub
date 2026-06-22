import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * Matrix renders rich text via `org.matrix.custom.html` `formatted_body`
 * (a safe HTML subset) with a plain-text `body` fallback. This converter
 * keeps the plain-text round-trip for the Chat SDK's postable rendering;
 * {@link markdownToMatrixHtml} produces the HTML side from the same source.
 *
 * @see https://spec.matrix.org/latest/client-server-api/#mroommessage-msgtypes
 */
export class MatrixFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(text: string): Root {
    return parseMarkdown(text.trim());
  }
}

/**
 * Convert Markdown to the Matrix HTML subset by walking the `mdast` AST
 * produced by `parseMarkdown`. Walking the AST (rather than regex) keeps
 * nesting, escaping, and code-block fences correct.
 *
 * Supported nodes cover the common agent-reply surface: headings, paragraphs,
 * emphasis/strong/strikethrough, inline code, fenced code, links, images,
 * ordered/unordered lists, blockquotes, rules and hard breaks. Unknown nodes
 * fall back to their text content.
 */
export function markdownToMatrixHtml(markdown: string): string {
  if (!markdown) return '';
  const ast = parseMarkdown(markdown);
  return renderNodes((ast as unknown as MdNode).children ?? []).trim();
}

interface MdNode {
  alt?: string;
  children?: MdNode[];
  depth?: number;
  lang?: string;
  ordered?: boolean;
  start?: number | null;
  title?: string;
  type: string;
  url?: string;
  value?: string;
}

function renderNodes(nodes: MdNode[]): string {
  return nodes.map((n) => renderNode(n)).join('');
}

function renderNode(node: MdNode): string {
  switch (node.type) {
    case 'paragraph': {
      return `<p>${renderNodes(node.children ?? [])}</p>`;
    }
    case 'heading': {
      const level = Math.min(Math.max(node.depth ?? 1, 1), 6);
      return `<h${level}>${renderNodes(node.children ?? [])}</h${level}>`;
    }
    case 'text': {
      return escapeHtml(node.value ?? '');
    }
    case 'strong': {
      return `<strong>${renderNodes(node.children ?? [])}</strong>`;
    }
    case 'emphasis': {
      return `<em>${renderNodes(node.children ?? [])}</em>`;
    }
    case 'delete': {
      return `<del>${renderNodes(node.children ?? [])}</del>`;
    }
    case 'inlineCode': {
      return `<code>${escapeHtml(node.value ?? '')}</code>`;
    }
    case 'code': {
      const cls = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : '';
      return `<pre><code${cls}>${escapeHtml(node.value ?? '')}</code></pre>`;
    }
    case 'blockquote': {
      return `<blockquote>${renderNodes(node.children ?? [])}</blockquote>`;
    }
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const startAttr =
        node.ordered && node.start != null && node.start !== 1
          ? ` start="${node.start}"`
          : '';
      return `<${tag}${startAttr}>${renderNodes(node.children ?? [])}</${tag}>`;
    }
    case 'listItem': {
      // Unwrap a lone paragraph so list items don't get nested <p> blocks.
      const children = node.children ?? [];
      const inner =
        children.length === 1 && children[0].type === 'paragraph'
          ? renderNodes(children[0].children ?? [])
          : renderNodes(children);
      return `<li>${inner}</li>`;
    }
    case 'link': {
      const href = escapeAttr(node.url ?? '');
      return `<a href="${href}">${renderNodes(node.children ?? [])}</a>`;
    }
    case 'image': {
      const src = escapeAttr(node.url ?? '');
      const alt = escapeAttr(node.alt ?? '');
      return `<img src="${src}" alt="${alt}" />`;
    }
    case 'thematicBreak': {
      return '<hr />';
    }
    case 'break': {
      return '<br />';
    }
    default: {
      if (node.children?.length) return renderNodes(node.children);
      return escapeHtml(node.value ?? '');
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replaceAll('"', '&quot;');
}

/** Strip an `org.matrix.custom.html` body down to readable plain text. */
export function htmlToPlainText(html: string): string {
  return html
    .replaceAll(/<br\s*\/?>/gi, '\n')
    .replaceAll(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}
