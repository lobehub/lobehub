import { artboardOpSchema } from '@lobechat/types';
import type { Command } from 'commander';
import { z } from 'zod';

import { outputJson } from '../utils/format';

interface SchemaNode {
  anyOf?: SchemaNode[];
  const?: unknown;
  enum?: unknown[];
  oneOf?: SchemaNode[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  type?: string;
}

const literal = (value: unknown) => JSON.stringify(value);

const renderNode = (node: SchemaNode): string => {
  if (node.const !== undefined) return literal(node.const);
  if (node.enum) return node.enum.map(literal).join(' | ');
  const variants = node.oneOf ?? node.anyOf;
  if (variants) return variants.map(renderNode).join(' | ');
  if (node.type === 'object' && node.properties) return renderObject(node);
  if (node.type === 'integer') return 'number';
  return node.type ?? 'unknown';
};

const renderObject = (node: SchemaNode) => {
  const required = new Set(node.required);
  const rank = ([key, value]: [string, SchemaNode]) =>
    value.const !== undefined ? 0 : required.has(key) ? 1 : 2;
  const fields = Object.entries(node.properties!)
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(
      ({ entry: [key, value] }) => `"${key}"${required.has(key) ? '' : '?'}: ${renderNode(value)}`,
    );
  return `{ ${fields.join(', ')} }`;
};

const NOTES = [
  '--ops takes a JSON array of these, inline or as @file.json. Every op in one call applies, or none does.',
  'A field marked ? is optional.',
  '"ref" is a name you choose on an add op; later ops in the same call can use it wherever an id is expected.',
  'x and y are page coordinates; w and h default to 640×400. A board without pageId lands on the page of its group or round, otherwise on the first page.',
  'An image source takes the file id that `lh file upload --json` returns as "fileRef".',
  'A canvas source takes the id of a published Canvas (`lh artifact guide canvas`).',
  'A board of type "decision" has no source and no "expected". Type "html" goes with a canvas source and "image" with an image source; "video" is refused.',
  '"recommended" marks a board as the option you would pick in its round; it needs "roundId", and a board with a "roundId" must sit in an options group.',
];

const opsAction = (options: { json?: boolean }) => {
  const schema = z.toJSONSchema(artboardOpSchema) as SchemaNode;
  if (options.json) return outputJson(schema);

  console.log('Ops accepted by `lh artboard create --ops` and `lh artboard update --ops`:\n');
  for (const op of schema.oneOf ?? schema.anyOf ?? []) console.log(`  ${renderNode(op)}\n`);
  for (const note of NOTES) console.log(`- ${note}`);
};

export const registerArtboardOpsCommand = (artboard: Command) => {
  artboard
    .command('ops')
    .description('Print the shape of every op that create and update accept')
    .option('--json', 'Print the ops as JSON Schema')
    .action(opsAction);
};
