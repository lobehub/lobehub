import { Parser } from 'htmlparser2';

import { resolveCanvasHref } from '../project/path';
import {
  CANVAS_COMPONENT_MAP,
  CANVAS_COMPONENTS,
  CANVAS_PALETTE,
  CANVAS_TAG_PREFIX,
  isCanvasGlobalAttribute,
} from '../schema/components';
import type { CanvasAttributeSpec, CanvasComponentSpec } from '../schema/types';
import { checkScriptText, collectCssRefs, findHardCodedColor, lineAt } from './text';
import type { CanvasIssue, CanvasValidationOptions } from './types';

export interface CanvasProjectIndex {
  has: (path: string) => boolean;
  readText: (path: string) => string | undefined;
}

interface ComponentFrame {
  attrs: Record<string, string>;
  line: number;
  provided: Set<string>;
  spec: CanvasComponentSpec;
  text: string;
}

interface ElementFrame {
  component?: ComponentFrame;
  tag: string;
}

const RESOURCE_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  audio: ['src'],
  embed: ['src'],
  iframe: ['src'],
  img: ['src'],
  link: ['href'],
  script: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
};

const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = a[i - 1] === b[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = current;
    }
  }
  return row[b.length];
};

const suggestTag = (tag: string) => {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const spec of CANVAS_COMPONENTS) {
    const distance = levenshtein(tag, spec.tag);
    if (distance < bestDistance) {
      best = spec.tag;
      bestDistance = distance;
    }
  }
  return bestDistance <= 3 ? best : undefined;
};

const isJsonScript = (attrs: Record<string, string>) =>
  attrs.type?.trim().toLowerCase() === 'application/json';

const isExecutableScript = (attrs: Record<string, string>) => {
  const type = attrs.type?.trim().toLowerCase();
  return !type || type === 'module' || type.includes('javascript');
};

const checkValue = (name: string, spec: CanvasAttributeSpec, value: string): string | undefined => {
  switch (spec.type) {
    case 'number': {
      return value.trim() !== '' && Number.isFinite(Number(value)) ? undefined : 'expects a number';
    }
    case 'boolean': {
      return ['', 'true', 'false', name].includes(value)
        ? undefined
        : 'is a boolean: write it bare or "true"/"false"';
    }
    case 'enum': {
      return spec.values?.includes(value)
        ? undefined
        : `must be one of: ${spec.values?.join(', ')}`;
    }
    case 'json': {
      return checkJson(name, value);
    }
    default: {
      return undefined;
    }
  }
};

const checkJson = (name: string, text: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return `is not valid JSON (${(error as Error).message})`;
  }
  if (name === 'colors') {
    const palette = new Set<string>(CANVAS_PALETTE);
    if (!Array.isArray(parsed) || parsed.some((color) => !palette.has(color))) {
      return `must be a JSON array of palette names: ${CANVAS_PALETTE.join(', ')}`;
    }
  }
};

export const validateHtmlFile = (
  file: string,
  html: string,
  project: CanvasProjectIndex,
  options: CanvasValidationOptions = {},
): CanvasIssue[] => {
  const issues: CanvasIssue[] = [];
  const stack: ElementFrame[] = [];
  let pendingScript: { attrs: Record<string, string>; line: number; text: string } | undefined;
  let pendingStyle: { line: number; text: string } | undefined;

  const report = (line: number, rule: CanvasIssue['rule'], message: string) =>
    issues.push({ file, line, message, rule });

  const checkRef = (line: number, tag: string, attr: string, value: string) => {
    const resolved = resolveCanvasHref(file, value);
    if (resolved.kind === 'remote') {
      if (tag === 'a') return;
      report(
        line,
        'remote-resource',
        `<${tag} ${attr}="${value}"> loads a remote resource. Copy it into the project and reference it by relative path.`,
      );
      return;
    }
    if (resolved.kind !== 'local') return;
    if (!resolved.path || !project.has(resolved.path)) {
      report(
        line,
        'broken-reference',
        `<${tag} ${attr}="${value}"> points at a file that is not in the project.`,
      );
    }
  };

  const checkCss = (text: string, lineOffset: number) => {
    for (const ref of collectCssRefs(text)) {
      const resolved = resolveCanvasHref(file, ref.href);
      const line = lineOffset + lineAt(text, ref.index) - 1;
      if (resolved.kind === 'remote') {
        report(
          line,
          'remote-resource',
          `CSS reference "${ref.href}" is remote. Copy it into the project.`,
        );
      } else if (resolved.kind === 'local' && (!resolved.path || !project.has(resolved.path))) {
        report(
          line,
          'broken-reference',
          `CSS reference "${ref.href}" points at a file that is not in the project.`,
        );
      }
    }
  };

  const openComponent = (
    tag: string,
    attrs: Record<string, string>,
    line: number,
  ): ComponentFrame | undefined => {
    const spec = CANVAS_COMPONENT_MAP.get(tag);
    if (!spec) {
      const suggestion = suggestTag(tag);
      report(
        line,
        'unknown-component',
        `<${tag}> is not a Canvas component.${suggestion ? ` Did you mean <${suggestion}>?` : ''} See the component reference in the Canvas skill.`,
      );
      return;
    }

    const parent = stack.at(-1)?.tag;
    if (spec.parents && (!parent || !spec.parents.includes(parent))) {
      report(
        line,
        'misplaced-component',
        `<${tag}> must be a direct child of ${spec.parents.map((p) => `<${p}>`).join(' or ')}.`,
      );
    }

    const frame: ComponentFrame = { attrs, line, provided: new Set(), spec, text: '' };

    for (const [name, value] of Object.entries(attrs)) {
      const attrSpec = spec.attributes[name];
      if (attrSpec) {
        frame.provided.add(name);
        const problem = checkValue(name, attrSpec, value);
        if (problem) report(line, 'invalid-attribute', `<${tag} ${name}> ${problem}.`);
        continue;
      }

      const sourceOf = name.endsWith('-src') ? name.slice(0, -'-src'.length) : undefined;
      if (sourceOf && spec.attributes[sourceOf]?.type === 'json') {
        frame.provided.add(sourceOf);
        const resolved = resolveCanvasHref(file, value);
        if (resolved.kind !== 'local' || !resolved.path || !project.has(resolved.path)) {
          report(
            line,
            'broken-reference',
            `<${tag} ${name}="${value}"> must point at a .json file in the project.`,
          );
          continue;
        }
        const text = project.readText(resolved.path);
        const problem = text === undefined ? 'is not a text file' : checkJson(sourceOf, text);
        if (problem)
          report(line, 'invalid-attribute', `<${tag} ${name}>: ${resolved.path} ${problem}.`);
        continue;
      }

      if (isCanvasGlobalAttribute(name)) {
        if (name === 'style') {
          const color = findHardCodedColor(value);
          if (color)
            report(
              line,
              'hard-coded-color',
              `<${tag} style="${color}"> hard-codes a color. Components follow the app theme; use a variant/type/color attribute or a var(--lobe-*) token.`,
            );
        }
        continue;
      }

      report(
        line,
        'unknown-attribute',
        `<${tag}> has no attribute "${name}". Allowed: ${Object.keys(spec.attributes).join(', ') || 'none'}.`,
      );
    }

    return frame;
  };

  const closeComponent = (frame: ComponentFrame) => {
    for (const [name, attrSpec] of Object.entries(frame.spec.attributes)) {
      if (attrSpec.required && !frame.provided.has(name)) {
        report(
          frame.line,
          'missing-attribute',
          `<${frame.spec.tag}> requires "${name}" (${attrSpec.description})`,
        );
      }
    }
    if (frame.spec.tag === 'lobe-mermaid' && options.checkMermaid) {
      const problem = options.checkMermaid(frame.text);
      if (problem) {
        const line = problem.line ? frame.line + problem.line - 1 : frame.line;
        const message = problem.line
          ? problem.message.replace(`line ${problem.line}`, `line ${line}`)
          : problem.message;
        report(line, 'invalid-diagram', `<lobe-mermaid> is not valid Mermaid. ${message}`);
      }
    }
  };

  const parser: Parser = new Parser(
    {
      onclosetag(tag) {
        if (tag === 'script' && pendingScript) {
          const { attrs, line, text } = pendingScript;
          pendingScript = undefined;
          if (isJsonScript(attrs)) {
            const prop = attrs['data-prop'];
            const owner = [...stack].reverse().find((frame) => frame.tag !== 'script')?.component;
            if (prop && owner) {
              const attrSpec = owner.spec.attributes[prop];
              if (attrSpec?.type === 'json') {
                owner.provided.add(prop);
                const problem = checkJson(prop, text);
                if (problem)
                  report(
                    line,
                    'invalid-attribute',
                    `<${owner.spec.tag}> data-prop="${prop}" script ${problem}.`,
                  );
              } else {
                report(
                  line,
                  'unknown-attribute',
                  `<${owner.spec.tag}> has no JSON attribute "${prop}".`,
                );
              }
            }
          } else if (isExecutableScript(attrs) && !attrs.src) {
            issues.push(...checkScriptText(file, text, line));
          }
        }
        if (tag === 'style' && pendingStyle) {
          checkCss(pendingStyle.text, pendingStyle.line);
          pendingStyle = undefined;
        }

        const index = stack.findLastIndex((frame) => frame.tag === tag);
        if (index === -1) return;
        for (const frame of stack.splice(index).reverse())
          if (frame.component) closeComponent(frame.component);
      },
      onopentag(tag, attrs) {
        const line = lineAt(html, parser.startIndex);

        if (
          html.slice(parser.startIndex, parser.endIndex + 1).endsWith('/>') &&
          tag.startsWith(CANVAS_TAG_PREFIX)
        ) {
          report(
            line,
            'self-closing-component',
            `<${tag} /> is not closed in HTML. Write <${tag}></${tag}>.`,
          );
        }

        for (const attr of RESOURCE_ATTRIBUTES[tag] ?? []) {
          if (attrs[attr] !== undefined) checkRef(line, tag, attr, attrs[attr]);
        }
        if (attrs.style) checkCss(attrs.style, line);

        const textOwner = stack.at(-1)?.component;
        if (textOwner?.spec.children === 'text') {
          report(
            line,
            'markup-in-text',
            `<${tag}> inside <${textOwner.spec.tag}> is parsed as an element and its text is lost. <${textOwner.spec.tag}> holds plain text: write < as &lt; and & as &amp;.`,
          );
        }

        const component = tag.startsWith(CANVAS_TAG_PREFIX)
          ? openComponent(tag, attrs, line)
          : undefined;
        stack.push({ component, tag });

        if (tag === 'script') pendingScript = { attrs, line, text: '' };
        if (tag === 'style') pendingStyle = { line, text: '' };
      },
      ontext(text) {
        const textOwner = stack.at(-1)?.component;
        if (textOwner?.spec.children === 'text') textOwner.text += text;
        if (pendingScript) pendingScript.text += text;
        if (pendingStyle) pendingStyle.text += text;
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true },
  );

  parser.write(html);
  parser.end();

  for (const frame of stack.reverse()) if (frame.component) closeComponent(frame.component);

  return issues;
};
