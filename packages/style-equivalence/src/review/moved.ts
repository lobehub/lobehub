import { family, parseDeclarations } from './declarations';
import { type Compound, lastCompounds } from './selectorText';

export interface MovedElement {
  attributes?: Record<string, string>;
  id: string;
  parent?: string;
  slots: string[];
  tag: string;
}

export interface MovedRule {
  selector: string;
  slot: string;
  tags: string[];
  targets: string[];
  text: string;
}

export interface MovedInput {
  base: { declarations: Record<string, string>; slots?: string[] };
  head: { chain: MovedElement[]; elements: MovedElement[]; texts: Record<string, string> };
}

const ruleSelector = (scope: string) => scope.split(' @')[0].trim();

const matches = (element: MovedElement, compounds: Compound[]) =>
  compounds.some(
    ({ attributes, tag }) =>
      (!tag || tag === element.tag) &&
      attributes.every(({ name, value }) =>
        value === undefined
          ? element.attributes?.[name] !== undefined
          : element.attributes?.[name] === value,
      ),
  );

const isInside = (element: MovedElement, ancestor: string, byId: Map<string, MovedElement>) => {
  for (let current = element.parent; current; current = byId.get(current)?.parent)
    if (current === ancestor) return true;
  return false;
};

export const movedRules = ({ base, head }: MovedInput): Record<string, MovedRule[]> => {
  const byId = new Map(head.elements.map((element) => [element.id, element]));
  const existing = new Set(base.slots);
  const result: Record<string, MovedRule[]> = {};
  for (const [slot, text] of Object.entries(base.declarations)) {
    const owner =
      head.chain.findLast((element) => element.slots.includes(slot)) ?? head.chain.at(-1);
    if (!owner) continue;
    const inside = head.elements.filter((element) => isInside(element, owner.id, byId));
    const ruleFamilies = new Map<string, Set<string>>();
    for (const row of parseDeclarations(text)) {
      if (!row.descendant) continue;
      const selector = ruleSelector(row.selector);
      ruleFamilies.set(
        selector,
        (ruleFamilies.get(selector) ?? new Set()).add(family(row.property)),
      );
    }
    const carries = (target: string, families: Set<string>) =>
      parseDeclarations(head.texts[target] ?? '').some((row) => families.has(family(row.property)));
    const rules: MovedRule[] = [];
    for (const [selector, families] of ruleFamilies) {
      const compounds = lastCompounds(selector);
      if (!compounds) continue;
      const targets = inside.filter((element) => matches(element, compounds));
      const slots = [...new Set(targets.flatMap((element) => element.slots))].filter(
        (target) => !existing.has(target) && carries(target, families),
      );
      for (const target of slots) {
        const carriers = targets.filter((element) => element.slots.includes(target));
        rules.push({
          selector,
          slot: target,
          tags: [...new Set(carriers.map((element) => element.tag))],
          targets: carriers.map((element) => element.id),
          text: head.texts[target] ?? `UNRESOLVED:${target}`,
        });
      }
    }
    if (rules.length) result[slot] = rules;
  }
  return result;
};
