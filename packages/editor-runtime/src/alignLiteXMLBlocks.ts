import { parseLiteXMLBlocks } from './liteXMLBlockDiff';

const withId = (xml: string, id: string) => xml.replace(/^<([a-z][\w-]*)/i, `<$1 id="${id}"`);

// Index pairs of equal items in a longest common subsequence, in order.
const commonPairs = (a: string[], b: string[]): [number, number][] => {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const lengths = Array.from({ length: midA.length + 1 }, () => new Int32Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        midA[i] === midB[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const pairs: [number, number][] = [];
  for (let k = 0; k < start; k += 1) pairs.push([k, k]);
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      pairs.push([start + i, start + j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1;
    else j += 1;
  }
  for (let k = 0; k < a.length - endA; k += 1) pairs.push([endA + k, endB + k]);
  return pairs;
};

/**
 * Re-keys a rewrite of a page that carries none of its LiteXML ids (another
 * editor's export, a Markdown write) onto the current page, so a block diff
 * touches only what changed: a block that reads the same keeps the current
 * block as is, a changed block takes the id of the block it replaces (same
 * position, same tag), and the rest are new.
 *
 * Returns undefined when either document is not valid LiteXML.
 */
export const alignLiteXMLBlocks = (current: string, target: string): string | undefined => {
  const before = parseLiteXMLBlocks(current);
  const after = parseLiteXMLBlocks(target);
  if (typeof before === 'string' || typeof after === 'string') return;

  const pairs = commonPairs(
    before.map((block) => block.bare),
    after.map((block) => block.bare),
  );

  const aligned: string[] = [];
  let i = 0;
  let j = 0;
  for (const [keptBefore, keptAfter] of [...pairs, [before.length, after.length]]) {
    const replaced = before.slice(i, keptBefore);
    after.slice(j, keptAfter).forEach((block, k) => {
      const previous = replaced[k];
      aligned.push(
        previous?.id && previous.tag === block.tag ? withId(block.bare, previous.id) : block.bare,
      );
    });
    if (keptBefore < before.length) aligned.push(before[keptBefore].xml);
    i = keptBefore + 1;
    j = keptAfter + 1;
  }

  return `<root>${aligned.join('')}</root>`;
};
