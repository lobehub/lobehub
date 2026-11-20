import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { DomUtils, parseDocument } from 'htmlparser2';
import valueParser from 'postcss-value-parser';

import { getCanvasFileExtension, resolveCanvasHref } from '../project/path';
import type { CanvasPreviewProject, CanvasProjectSnapshot } from '../project/snapshot';

export const prepareCanvasProject = (snapshot: CanvasProjectSnapshot): CanvasPreviewProject => {
  const files = Object.fromEntries(snapshot.files.map(({ path, ...file }) => [path, { ...file }]));
  const resolve = (from: string, href: string) => {
    const ref = resolveCanvasHref(from, href);
    if (ref.kind !== 'local') return;
    if (!ref.path || !files[ref.path]) throw new Error(`${from}: missing project file ${href}`);
    return ref.path;
  };
  const resource = (from: string, href: string, page = false) => {
    const path = resolve(from, href);
    if (!path) return href;
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    const prefix = page && getCanvasFileExtension(path) === 'html' ? 'page' : 'file';
    return `lobe-canvas-${prefix}/${encodeURIComponent(path)}${hash}`;
  };
  const css = (from: string, source: string) => {
    const value = valueParser(source);
    value.walk((node) => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        const url = node.nodes.find((child) => child.type === 'word' || child.type === 'string');
        if (url) url.value = resource(from, url.value);
        return false;
      }
    });
    for (let i = 0; i < value.nodes.length; i++) {
      const node = value.nodes[i];
      if (node.type !== 'word' || node.value.toLowerCase() !== '@import') continue;
      const next = value.nodes
        .slice(i + 1)
        .find((child) => child.type !== 'space' && child.type !== 'comment');
      if (next?.type === 'string') next.value = resource(from, next.value);
    }
    return value.toString();
  };
  const script = (from: string, source: string) => {
    const edits: { start: number; end: number; text: string }[] = [];
    const special: { start: number; end: number }[] = [];
    let ast: ReturnType<typeof parse>;
    try {
      ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
      // Classic scripts permit non-strict syntax that module parsing rejects.
      ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
    }
    const moduleRef = (node: { start: number; end: number; value?: unknown }) => {
      if (typeof node.value !== 'string') return;
      const path = resolve(from, node.value);
      if (!path) throw new Error(`${from}: imports must reference project files`);
      edits.push({
        start: node.start,
        end: node.end,
        text: JSON.stringify(`lobe-canvas-project/${path}`),
      });
    };
    simple(ast, {
      ImportDeclaration: (node) => moduleRef(node.source),
      ExportAllDeclaration: (node) => moduleRef(node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) moduleRef(node.source);
      },
      ImportExpression: (node) => {
        edits.push({
          start: node.start,
          end: node.source.start,
          text: `window.__LOBE_CANVAS_IMPORT__(${JSON.stringify(from)},`,
        });
      },
      NewExpression: (node) => {
        const base = node.arguments[1];
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'URL' ||
          !base ||
          base.type !== 'MemberExpression' ||
          base.object.type !== 'MetaProperty' ||
          base.property.type !== 'Identifier' ||
          base.property.name !== 'url'
        )
          return;
        special.push({ start: node.start, end: node.end });
        edits.push({
          start: node.start,
          end: node.end,
          text: `window.__LOBE_CANVAS_URL__(${JSON.stringify(from)},${source.slice(node.arguments[0].start, node.arguments[0].end)})`,
        });
      },
      MemberExpression: (node) => {
        if (
          node.object.type === 'MetaProperty' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'url'
        )
          edits.push({
            start: node.start,
            end: node.end,
            text: JSON.stringify(`https://canvas.invalid/${from}`),
          });
      },
    });
    for (const edit of edits
      .filter((edit) => !special.some((range) => edit.start > range.start && edit.end <= range.end))
      .sort((a, b) => b.start - a.start))
      source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
  };
  const srcset = (from: string, source: string) => {
    const edits: { start: number; end: number; text: string }[] = [];
    let i = 0;
    while (i < source.length) {
      while (i < source.length && /[\s,]/.test(source[i])) i++;
      const start = i;
      const data = source.slice(i, i + 5).toLowerCase() === 'data:';
      while (i < source.length && !/\s/.test(source[i]) && (data || source[i] !== ',')) i++;
      let end = i;
      while (source[end - 1] === ',') end--;
      if (end > start) edits.push({ start, end, text: resource(from, source.slice(start, end)) });
      if (end < i || source[i] === ',') continue;
      while (i < source.length && source[i] !== ',') i++;
    }
    for (const edit of edits.reverse())
      source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
  };

  for (const [path, file] of Object.entries(files)) {
    if (file.encoding !== 'utf8') continue;
    switch (getCanvasFileExtension(path)) {
      case 'js':
      case 'mjs': {
        file.content = script(path, file.content);
        break;
      }
      case 'css': {
        file.content = css(path, file.content);
        break;
      }
      case 'html': {
        const doc = parseDocument(file.content);
        const elements = DomUtils.getElementsByTagName('*', doc.children, true);
        for (const element of elements) {
          for (const [name, href] of Object.entries(element.attribs)) {
            if (name === 'style') element.attribs[name] = css(path, href);
            else if (name === 'srcset') element.attribs[name] = srcset(path, href);
            else if (
              ['src', 'href', 'poster', 'xlink:href'].includes(name) ||
              name.endsWith('-src')
            )
              element.attribs[name] = resource(path, href, element.name === 'a');
          }
          for (const child of element.children) {
            if (child.type !== 'text') continue;
            if (element.name === 'style') child.data = css(path, child.data);
            if (
              element.name === 'script' &&
              !element.attribs.src &&
              (!element.attribs.type ||
                element.attribs.type === 'module' ||
                element.attribs.type.includes('javascript'))
            )
              child.data = script(path, child.data);
          }
        }
        file.content = DomUtils.getOuterHTML(doc);
        break;
      }
    }
  }
  if (!files[snapshot.entry]) throw new Error(`Missing Canvas entry ${snapshot.entry}`);
  return { entry: snapshot.entry, files };
};
