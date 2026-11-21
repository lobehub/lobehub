import selectorParser from 'postcss-selector-parser';

export interface SelectorNode {
  attribute?: string;
  nodes?: SelectorNode[];
  operator?: string;
  type: string;
  value?: string;
}

export const parseSelectorList = (text: string): SelectorNode[][] | undefined => {
  let selectors: SelectorNode[][] = [];
  try {
    selectorParser((root) => {
      // Reading .nodes through the library types trips TS5115 (circular Container/Diff instantiation).
      const { nodes } = root as unknown as { nodes: Array<{ nodes: SelectorNode[] }> };
      selectors = nodes.map((selector) => selector.nodes);
    }).processSync(text);
  } catch {
    return undefined;
  }
  return selectors;
};
