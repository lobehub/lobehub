import type { Page } from '@playwright/test';
import { z } from 'zod';

import { parseWidthCondition } from './conditionPartitions';
import type { collectRulesInPage } from './ruleInventory';
import type { RuntimeCompositions } from './runtimeCompositions';
import { analyzeSelector } from './selectorAnalysis';
import type { StyleBindingPlan } from './styleBindings';

const runtimeBindingsSchema = z.record(z.string(), z.record(z.string(), z.string()));
export type RuntimeBindings = z.infer<typeof runtimeBindingsSchema>;
type Inventory = ReturnType<typeof collectRulesInPage>;

export const readRuntimeBindings = async (page: Page) =>
  runtimeBindingsSchema.parse(
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__styleVerificationBindings');
      if (!descriptor || !('value' in descriptor))
        throw new Error('STYLE_BINDING_OBSERVER_MISSING');
      return Object.fromEntries(
        Object.entries(Object.getOwnPropertyDescriptors(descriptor.value)).map(
          ([symbol, binding]) => {
            if (!('value' in binding)) throw new Error('STYLE_BINDING_ACCESSOR_UNSUPPORTED');
            return [
              symbol,
              Object.fromEntries(
                Object.entries(Object.getOwnPropertyDescriptors(binding.value)).map(
                  ([name, slot]) => {
                    if (!('value' in slot)) throw new Error('STYLE_BINDING_ACCESSOR_UNSUPPORTED');
                    return [name, slot.value];
                  },
                ),
              ),
            ];
          },
        ),
      );
    }),
  );

export const planRuleWitnesses = (
  inventory: Inventory,
  plan: StyleBindingPlan,
  bindings: RuntimeBindings,
  compositions: RuntimeCompositions = { records: [], gaps: [] },
) => {
  const classes = new Map<string, Array<{ slot: string; unitId: string }>>();
  const gaps = [...plan.gaps, ...compositions.gaps];
  for (const binding of plan.bindings)
    for (const slot of binding.slots) {
      const value = bindings[binding.symbol]?.[slot.name];
      if (!value) {
        gaps.push(`SOURCE_SLOT_NOT_EXPORTED:${binding.symbol}.${slot.name}`);
        continue;
      }
      for (const name of value.split(/\s+/).filter(Boolean)) {
        const current = classes.get(name) ?? [];
        current.push({ slot: `${binding.symbol}.${slot.name}`, unitId: slot.unitId });
        classes.set(name, current);
      }
    }
  // cx may replace several registered classes with one new class. Retain the
  // union of originating slots; this is NOT per-declaration ownership proof.
  const composedClasses = new Set<string>();
  for (let pass = 0; pass <= compositions.records.length; pass++) {
    let changed = false;
    for (const record of compositions.records) {
      const inputs = record.inputs.flatMap((value) => value.split(/\s+/).filter(Boolean));
      const origins = inputs.flatMap((name) => classes.get(name) ?? []);
      for (const name of record.output.split(/\s+/).filter(Boolean)) {
        if (inputs.includes(name)) continue;
        const current = classes.get(name) ?? [];
        const merged = [
          ...new Map([...current, ...origins].map((slot) => [slot.slot, slot])).values(),
        ];
        if (merged.length !== current.length) {
          classes.set(name, merged);
          composedClasses.add(name);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (const record of compositions.records) {
    if (
      record.inputs
        .flatMap((value) => value.split(/\s+/).filter(Boolean))
        .some((name) => !classes.has(name))
    )
      gaps.push('COMPOSITION_INPUT_SOURCE_UNPROVEN');
    if (plan.composition && !plan.composition.calls.some((call) => call.start === record.callId))
      gaps.push('COMPOSITION_CALL_SITE_UNBOUND');
  }
  if (composedClasses.size) gaps.push('COMPOSITION_DECLARATION_OWNERSHIP_UNPROVEN');
  const rules = [];
  for (const rule of inventory.rules) {
    const selectorText =
      rule.selector ??
      (rule.kind === 'CSSNestedDeclarations' ? rule.selectorAncestors.at(-1) : undefined);
    if (!selectorText) continue;
    let branches;
    try {
      branches = analyzeSelector(selectorText);
    } catch (error) {
      console.error('COMPILED_SELECTOR_PARSE_ERROR', error);
      gaps.push(`COMPILED_SELECTOR_PARSE_ERROR:${rule.path}`);
      continue;
    }
    for (const [index, branch] of branches.entries()) {
      const ancestorClasses = rule.selectorAncestors.flatMap((selector) =>
        analyzeSelector(selector).flatMap((branch) => branch.classes),
      );
      const slots = [...branch.classes, ...ancestorClasses].flatMap(
        (name) => classes.get(name) ?? [],
      );
      if (!slots.length) continue;
      const limitations = [...branch.gaps];
      if (rule.selectorAncestors.length) limitations.push('NATIVE_NESTING_BINDING_UNSUPPORTED');
      for (const condition of rule.conditions)
        if (!['CSSContainerRule', 'CSSMediaRule', 'CSSSupportsRule'].includes(condition.kind))
          limitations.push(`CONDITION_KIND_UNSUPPORTED:${condition.kind}`);
        else if (condition.kind !== 'CSSSupportsRule' && !parseWidthCondition(condition.text))
          limitations.push(`WIDTH_CONDITION_UNSUPPORTED:${condition.text}`);
      rules.push({
        conditionModels: rule.conditions.map((condition) => ({
          ...condition,
          width:
            condition.kind === 'CSSSupportsRule' ? undefined : parseWidthCondition(condition.text),
        })),
        ...branch,
        conditions: rule.conditions,
        cssomPath: rule.path,
        gaps: [...new Set(limitations)],
        id: `${rule.path}:${index}`,
        sourceSlots: [...new Set(slots.map((slot) => slot.slot))],
        sourceUnitIds: [...new Set(slots.map((slot) => slot.unitId))],
      });
    }
  }
  return {
    compositions: [...composedClasses].map((name) => ({
      className: name,
      sourceSlots: classes.get(name)!.map((slot) => slot.slot),
    })),
    gaps: [...new Set(gaps)],
    rules,
  };
};
export type RuleWitnessPlan = ReturnType<typeof planRuleWitnesses>;

/** Run ONLY after product snapshots. Private non-inheriting markers, then cleanup. */
export const collectRuleWitnessesInPage = (input: {
  nonce: string;
  rules: RuleWitnessPlan['rules'];
}) => {
  if (!/^[a-f\d]{16}$/.test(input.nonce)) throw new Error('INVALID_WITNESS_NAMESPACE');
  if (input.rules.length > 1000) throw new Error('RULE_WITNESS_BUDGET_EXCEEDED');
  const root = document.querySelector('[data-case-root]');
  if (!root) throw new Error('RULE_WITNESS_ROOT_MISSING');
  const keys = new Map<Element, string>();
  const walk = (element: Element, key: string) => {
    keys.set(element, key);
    [...element.children]
      .filter((child) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(child.tagName))
      .forEach((child, index) => walk(child, `${key}.${index}`));
  };
  walk(root, 'root');
  const absoluteSelector = (element: Element) => {
    const segments: string[] = [];
    for (
      let current: Element | null = element;
      current?.parentElement;
      current = current.parentElement
    )
      segments.unshift(`:nth-child(${[...current.parentElement.children].indexOf(current) + 1})`);
    return [':root', ...segments].join(' > ');
  };
  const styles = new CSSStyleSheet();
  // The browser returns a live ObservableArray. Preserve its contents, not the
  // live object that assignment itself mutates, or cleanup retains the marker.
  const originalSheets = [...document.adoptedStyleSheets];
  const supported = input.rules.filter((rule) => !rule.gaps.length);
  const entries = supported.map((rule, index) => ({
    rule,
    property: `--style-verifier-${input.nonce}-${index}`,
  }));
  const text = entries
    .map(({ rule, property }) => {
      CSS.registerProperty({
        name: property,
        syntax: '<integer>',
        inherits: false,
        initialValue: '0',
      });
      let text = `${rule.selector}{${property}:1 !important;}`;
      for (const condition of [...rule.conditions].reverse()) {
        const kind =
          condition.kind === 'CSSContainerRule'
            ? 'container'
            : condition.kind === 'CSSMediaRule'
              ? 'media'
              : 'supports';
        text = `@${kind} ${condition.text}{${text}}`;
      }
      return text;
    })
    .join('\n');
  styles.replaceSync(text);
  const observations = [];
  try {
    document.adoptedStyleSheets = [...originalSheets, styles];
    for (const { rule, property } of entries) {
      const triggers =
        rule.states.length === 1
          ? [...document.querySelectorAll(rule.states[0].selector)].filter((element) =>
              root.contains(element),
            )
          : [];
      if (triggers.length > 512) throw new Error('RULE_TRIGGER_BUDGET_EXCEEDED');
      const targets = [...document.querySelectorAll(rule.targetSelector)]
        .filter((element) => root.contains(element))
        .map((element) => {
          const computed = getComputedStyle(element, rule.pseudo);
          const containers: Array<{
            key: string;
            name: string;
            type: string;
            width: number;
            metricsTrusted?: boolean;
          }> = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (!['size', 'inline-size'].includes(style.containerType)) continue;
            const width = Number.parseFloat(style.width);
            const padding =
              Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
            const border =
              Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
            containers.push({
              key: keys.get(parent) ?? 'outside-surface',
              name: style.containerName,
              type: style.containerType,
              width: style.boxSizing === 'border-box' ? width - padding - border : width,
              metricsTrusted:
                style.writingMode === 'horizontal-tb' &&
                !['auto', 'scroll'].includes(style.overflowX) &&
                !['auto', 'scroll'].includes(style.overflowY) &&
                style.scrollbarGutter === 'auto',
            });
          }
          const conditionStates = rule.conditionModels.map((condition) => {
            if (condition.kind === 'CSSMediaRule') return matchMedia(condition.text).matches;
            if (condition.kind === 'CSSSupportsRule') return CSS.supports(condition.text);
            const model = condition.width;
            if (!model) return null;
            const container = containers.find(
              (candidate) => !model.name || candidate.name.split(/\s+/).includes(model.name),
            );
            if (!container || !Number.isFinite(container.width)) return false;
            if (container.metricsTrusted === false) return null;
            return model.bounds.every(({ operator, value }) =>
              operator === '<'
                ? container.width < value
                : operator === '<='
                  ? container.width <= value
                  : operator === '>'
                    ? container.width > value
                    : operator === '>='
                      ? container.width >= value
                      : container.width === value,
            );
          });
          return {
            conditionStates,
            active: computed.getPropertyValue(property).trim() === '1',
            content: rule.pseudo ? computed.content : undefined,
            display: rule.pseudo ? computed.display : undefined,
            key: keys.get(element)!,
            triggers: triggers
              .filter((trigger) =>
                element.matches(
                  rule.bindingSelector.replaceAll(
                    ':--style-verifier-trigger',
                    `:is(${absoluteSelector(trigger)})`,
                  ),
                ),
              )
              .map((trigger) => ({
                key: keys.get(trigger)!,
                state: rule.states[0].state,
                tag: trigger.tagName,
              })),
            containers,
          };
        });
      observations.push({ id: rule.id, targets });
    }
    return {
      observations,
      registeredProperties: entries.map((entry) => entry.property),
      viewportWidth: innerWidth,
      direction: getComputedStyle(document.documentElement).direction,
    };
  } finally {
    document.adoptedStyleSheets = originalSheets;
  }
};
export type RuleObservation = ReturnType<typeof collectRuleWitnessesInPage>;
