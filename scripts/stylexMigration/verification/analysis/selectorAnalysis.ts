import selectorParser from 'postcss-selector-parser';

const dynamic = new Set([':hover', ':active', ':focus', ':focus-visible', ':focus-within']);
const structural = new Set([
  ':first-child',
  ':last-child',
  ':only-child',
  ':empty',
  ':root',
  ':first-of-type',
  ':last-of-type',
  ':only-of-type',
  ':nth-child',
  ':nth-last-child',
  ':nth-of-type',
  ':nth-last-of-type',
  ':not',
]);
const pseudos = new Set(['::before', '::after', '::marker', '::placeholder']);

/** One list branch per binding; never erase complex relations to claim support. */
export const analyzeSelector = (text: string) => {
  const root = selectorParser().astSync(text, { lossless: false });
  return root.nodes.map((original) => {
    const selector = original.clone();
    const binding = original.clone();
    const gaps = new Set<string>();
    if (text.includes(':--style-verifier-trigger')) gaps.add('TRIGGER_PLACEHOLDER_COLLISION');
    const classes = new Set<string>();
    const states: Array<{ selector: string; state: string }> = [];
    let pseudo: string | undefined;
    original.walkClasses((node) => {
      classes.add(node.value);
    });
    original.walkPseudos((node) => {
      if (pseudos.has(node.value)) {
        if (node.parent !== original || node !== original.last || pseudo)
          gaps.add('PSEUDO_TARGET_UNSUPPORTED');
        pseudo = node.value;
      } else if (dynamic.has(node.value)) {
        if (node.parent !== original) gaps.add('NESTED_STATE_SELECTOR_UNSUPPORTED');
        else {
          const prefix = original.clone();
          const position = original.nodes.indexOf(node);
          // Include the whole trigger compound, not only the part before :hover.
          const end = original.nodes.findIndex(
            (entry, index) => index > position && entry.type === 'combinator',
          );
          prefix.nodes
            .slice(end < 0 ? original.nodes.length : end)
            .forEach((entry) => entry.remove());
          prefix.walkPseudos((entry) => {
            if (dynamic.has(entry.value) || pseudos.has(entry.value)) entry.remove();
          });
          if (!prefix.nodes.length || prefix.last?.type === 'combinator')
            gaps.add('EMPTY_STATE_TRIGGER');
          states.push({ selector: prefix.toString(), state: node.value.slice(1) });
        }
      } else if (!structural.has(node.value)) gaps.add(`SELECTOR_PSEUDO_UNSUPPORTED:${node.value}`);
      if (node.value === ':not')
        node.walkPseudos((nested) => {
          if (nested !== node && dynamic.has(nested.value)) gaps.add('NEGATED_STATE_UNSUPPORTED');
        });
    });
    selector.walkPseudos((node) => {
      if (dynamic.has(node.value) || pseudos.has(node.value)) node.remove();
    });
    binding.walkPseudos((node) => {
      if (pseudos.has(node.value)) node.remove();
      else if (dynamic.has(node.value)) node.value = ':--style-verifier-trigger';
    });
    selector.walkNesting(() => {
      gaps.add('NATIVE_NESTING_BINDING_UNSUPPORTED');
    });
    if (!selector.nodes.length || selector.last?.type === 'combinator')
      gaps.add('EMPTY_STYLE_TARGET');
    return {
      classes: [...classes],
      bindingSelector: binding.toString(),
      gaps: [...gaps],
      pseudo,
      selector: original.toString(),
      states,
      targetSelector: selector.toString(),
    };
  });
};
