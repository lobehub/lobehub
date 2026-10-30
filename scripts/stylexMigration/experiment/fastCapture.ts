import type { CDPSession, Page } from '@playwright/test';

import type { StyleSnapshot } from './capture';
import { captureInPage } from './capture';

/** Blink batches standard computed properties and interns their values in DOMSnapshot.
 * Custom properties are not accepted by this CDP method. Resolved consumers still are.
 * No-layout nodes and pseudos missing from the protocol use the JS collector as fallback.
 */
export const createFastCapture = async (
  page: Page,
  cdp: CDPSession,
  options?: { properties: string[]; prepared: StyleSnapshot; nodeStyles?: boolean },
) => {
  const properties =
    options?.properties ??
    (await page.evaluate(() =>
      [...getComputedStyle(document.querySelector('[data-case-root]')!)].filter(
        (property) => !property.startsWith('--'),
      ),
    ));
  let preparedUsed = false;
  return async (
    animationTime?: number,
    timing?: Record<string, number>,
  ): Promise<StyleSnapshot> => {
    if (options?.prepared) {
      // A prepared frame is immediate, time-zero and one-shot. Never reuse its
      // names, geometry or custom values after a state/document change.
      if (animationTime !== undefined && animationTime !== 0)
        throw new Error('PREPARED_CAPTURE_REQUIRES_TIME_ZERO');
      if (preparedUsed) throw new Error('PREPARED_CAPTURE_ALREADY_USED');
      preparedUsed = true;
    }
    const started = performance.now();
    let phaseStarted = started;
    const metadata =
      options?.prepared ??
      (await page.evaluate(captureInPage, {
        animationTime,
        properties: ['animation-name'],
      }));
    if (timing) timing.metadata = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: properties });
    if (timing) timing.protocol = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    const styleValues = new Map<string, Record<string, string>>();
    const normalKeys = metadata.nodes
      .filter((node) => !node.key.includes('::'))
      .map((node) => node.key);
    for (const document of snapshot.documents) {
      const nodes = document.nodes;
      const nodeCount = nodes.nodeName?.length ?? 0;
      const keys = new Map<number, string>();
      for (let index = 0; index < nodeCount; index++) {
        const attributes = nodes.attributes?.[index] ?? [];
        for (let item = 0; item < attributes.length; item += 2) {
          if (snapshot.strings[attributes[item]] !== 'data-experiment-node') continue;
          const key = normalKeys[Number(snapshot.strings[attributes[item + 1]])];
          if (key) keys.set(index, key);
        }
      }
      for (let item = 0; item < (nodes.pseudoType?.index.length ?? 0); item++) {
        const index = nodes.pseudoType!.index[item];
        const parent = keys.get(nodes.parentIndex?.[index] ?? -1);
        if (parent)
          keys.set(index, `${parent}::${snapshot.strings[nodes.pseudoType!.value[item]]}`);
      }
      document.layout.nodeIndex.forEach((index, layoutIndex) => {
        const key = keys.get(index);
        const values = document.layout.styles[layoutIndex];
        if (!key || !values?.length) return;
        styleValues.set(
          key,
          Object.fromEntries(
            properties.map((property, propertyIndex) => [
              property,
              snapshot.strings[values[propertyIndex]] ?? '',
            ]),
          ),
        );
      });
    }
    const missing = metadata.nodes
      .filter((node) => !styleValues.has(node.key))
      .map((node) => node.key);
    if (timing) timing.decode = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    let fallbackReads = 0;
    if (missing.length) {
      const fallback = await page.evaluate(captureInPage, {
        animationTime,
        properties,
        styleKeys: missing,
      });
      fallbackReads = fallback.propertyReads;
      for (const node of fallback.nodes)
        if (missing.includes(node.key)) styleValues.set(node.key, fallback.styles[node.style]);
    }
    if (timing) timing.fallback = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    const styles: StyleSnapshot['styles'] = [];
    const interned = new Map<string, number>();
    const resultNodes = metadata.nodes.map((node) => {
      const values = {
        ...styleValues.get(node.key),
        ...metadata.styles[node.style],
      };
      if (options?.nodeStyles) {
        const style = styles.length;
        styles.push(values);
        return { ...node, style };
      }
      const signature = JSON.stringify(values);
      let style = interned.get(signature);
      if (style === undefined) {
        style = styles.length;
        styles.push(values);
        interned.set(signature, style);
      }
      return { ...node, style };
    });
    if (timing) timing.intern = performance.now() - phaseStarted;
    return {
      ...metadata,
      durationMs: performance.now() - started,
      nodes: resultNodes,
      propertyReads:
        metadata.propertyReads +
        properties.length * (metadata.nodes.length - missing.length) +
        fallbackReads,
      styles,
    };
  };
};
