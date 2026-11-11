import type { StyleElement } from '../extract';
import type { Combo } from '../plan/combos';
import { chainOf, type FilePlan, isIntrinsicTag, PASS_THROUGH_VARIABLES } from '../plan/planFile';
import { askSentence, comboLabel, differenceSummary } from '../report/plain';
import { defaultReworkNote } from '../report/review';
import { declarationBlocks } from '../review/declarations';
import { type MovedRule, movedRules } from '../review/moved';
import {
  elementSignature,
  passRecord,
  resolvedReworks,
  type ReviewItem,
  reviewItems,
  reworkRecord,
} from '../review/state';
import { type ReworkRecord, writeReviews } from '../review/store';
import {
  ApiError,
  currentVerdict,
  defaultSigner,
  readRunReviews,
  runPr,
  type StoredRun,
} from './api';

type Sides<T> = Partial<Record<'base' | 'head', T>>;

interface CaseEntry {
  category: string;
  key: string;
  plan: {
    combos?: Combo[];
    elementIds?: { base: string; head: string };
    file: string;
    standIns?: Sides<string[]>;
  };
  result?: {
    comboDifferences?: Array<{
      combo: number;
      condition: string;
      rootCauses: Array<{ after?: string; before?: string; key: string; property: string }>;
    }>;
    differingConditions?: string[];
    errors?: string[];
    rootCauses?: Array<{ after?: string; before?: string; key: string; property: string }>;
  };
}

interface CaseEvidence {
  counterpart?: Sides<string>;
  declarations?: Partial<Record<'base' | 'head', Record<string, string>>>;
  elements?: Partial<
    Record<
      'base' | 'head',
      Array<{ bindings: StyleElement['bindings']; slots?: string[]; tag: string }>
    >
  >;
}

const usageOf = (element: { bindings: StyleElement['bindings']; tag: string }) => {
  const props = element.bindings.map((binding) =>
    binding.spread ? `{...${binding.expr}}` : `${binding.prop}={${binding.expr}}`,
  );
  return `<${[element.tag, ...props].join(' ')}>`;
};

const standIns = (evidence: CaseEvidence | undefined, layout: Set<string>) => {
  const tags = new Map<string, string>();
  for (const side of ['head', 'base'] as const)
    for (const element of evidence?.elements?.[side] ?? [])
      if (!isIntrinsicTag(element.tag) && !layout.has(element.tag))
        for (const slot of element.slots ?? []) if (!tags.has(slot)) tags.set(slot, element.tag);
  return tags;
};

interface MovedSlot {
  selectors: string[];
  slot: string;
  tags: string[];
  text: string;
}

const groupMoved = (moved: Record<string, MovedRule[]>) =>
  Object.fromEntries(
    Object.entries(moved).map(([baseSlot, rules]) => {
      const bySlot = new Map<string, MovedSlot>();
      for (const rule of rules) {
        const group = bySlot.get(rule.slot) ?? {
          selectors: [],
          slot: rule.slot,
          tags: [],
          text: rule.text,
        };
        group.selectors = [...new Set([...group.selectors, rule.selector])];
        group.tags = [...new Set([...group.tags, ...rule.tags])];
        bySlot.set(rule.slot, group);
      }
      return [baseSlot, [...bySlot.values()]];
    }),
  );

const stylesOf = (
  entry: CaseEntry | undefined,
  evidence: CaseEvidence | undefined,
  layout: Set<string>,
  moved: Record<string, MovedRule[]> = {},
) => {
  const causes = [
    ...(entry?.result?.rootCauses ?? []),
    ...(entry?.result?.comboDifferences ?? []).flatMap((difference) => difference.rootCauses),
  ];
  const source = Object.fromEntries(
    (['base', 'head'] as const).flatMap((side) => {
      const declarations = evidence?.declarations?.[side];
      return declarations && Object.keys(declarations).length ? [[side, declarations]] : [];
    }),
  );
  return {
    blocks: evidence?.declarations
      ? declarationBlocks(
          evidence.declarations.base,
          evidence.declarations.head,
          causes.map((cause) => cause.property),
          moved,
        ).map(({ key, ...block }) => ({ ...block, standIn: standIns(evidence, layout).get(key) }))
      : [],
    counterpart: (['base', 'head'] as const).find(
      (side) => !evidence?.elements?.[side]?.length && evidence?.counterpart?.[side],
    ),
    moved: groupMoved(moved),
    source,
    usage: Object.fromEntries(
      (['base', 'head'] as const).flatMap((side) => {
        const chain = evidence?.elements?.[side];
        if (chain?.length) return [[side, chain.map(usageOf)]];
        const counterpart = evidence?.counterpart?.[side];
        return counterpart ? [[side, [counterpart]]] : [];
      }),
    ),
  };
};

type Extractions = Record<string, Partial<Record<'base' | 'head', { elements: StyleElement[] }>>>;

export const standInsFor = (
  key: string,
  entry: Pick<CaseEntry, 'plan'> | undefined,
  plans: Array<Pick<FilePlan, 'file' | 'standIns'> & Partial<Pick<FilePlan, 'unpaired'>>>,
): Sides<string[]> => {
  const unpaired = /^(.*)\|unpaired:(base|head):(.+)$/.exec(key);
  if (!unpaired) return entry?.plan.standIns ?? {};
  const [, file, side, id] = unpaired;
  const plan = plans.find((item) => item.file === file);
  const tags = plan?.standIns?.[`${side}:${id}`];
  if (!tags) return {};
  const mirrored = plan?.unpaired?.some(
    (item) => item.side === side && item.elementId === id && item.counterpart,
  );
  return mirrored ? { base: tags, head: tags } : { [side]: tags };
};

const elementFor = (stored: StoredRun, key: string, entry: CaseEntry | undefined) => {
  const extractions = stored.extractions as Extractions;
  const unpaired = /^(.*)\|unpaired:(base|head):(.+)$/.exec(key);
  const [file, side, id] = unpaired
    ? [unpaired[1], unpaired[2] as 'base' | 'head', unpaired[3]]
    : [entry?.plan.file ?? '', 'head' as const, entry?.plan.elementIds?.head];
  return extractions[file]?.[side]?.elements.find((element) => element.id === id);
};

const headTextsOf = (stored: StoredRun, file: string) => {
  const texts: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored.evidence))
    if (key.startsWith(`${file}|`))
      Object.assign(texts, (value as CaseEvidence | undefined)?.declarations?.head);
  return texts;
};

const movedOf = (
  stored: StoredRun,
  entry: CaseEntry | undefined,
  evidence: CaseEvidence | undefined,
) => {
  const base = evidence?.declarations?.base;
  const file = entry?.plan.file;
  const headId = entry?.plan.elementIds?.head;
  if (!base || !file || !headId) return {};
  const elements = (stored.extractions as Extractions)[file]?.head?.elements ?? [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const element = byId.get(headId);
  if (!element) return {};
  const baseSlots = (stored.extractions as Extractions)[file]?.base?.elements.flatMap(
    (element) => element.slots,
  );
  return movedRules({
    base: { declarations: base, slots: baseSlots },
    head: { chain: chainOf(element, byId), elements, texts: headTextsOf(stored, file) },
  });
};

const titleOf = (key: string, element: StyleElement | undefined) => {
  const id = key.slice(key.indexOf('|') + 1).replace(/^unpaired:\w+:/, '');
  const slot = element?.slots[0]?.split('.').pop();
  return slot ? `${id.split('#')[0]} · ${slot}` : id;
};

const contextOf = (stored: StoredRun) => {
  const cases = new Map(
    (stored.results.cases as unknown as CaseEntry[]).map((entry) => [entry.key, entry]),
  );
  const elements = new Map(
    stored.items.map((item) => [item.key, elementFor(stored, item.key, cases.get(item.key))]),
  );
  const signatures = new Map(
    [...elements].flatMap(([key, element]) => (element ? [[key, elementSignature(element)]] : [])),
  ) as Map<string, string>;
  const combos = new Map([...cases].map(([key, entry]) => [key, entry.plan.combos?.length ?? 1]));
  return { cases, combos, elements, signatures };
};

const describe = (
  item: ReviewItem,
  entry: CaseEntry | undefined,
  element?: StyleElement,
  evidence?: CaseEvidence,
  layout: Set<string> = new Set(),
  standIns: Sides<string[]> = {},
  moved: Record<string, MovedRule[]> = {},
) => {
  const component = element && !isIntrinsicTag(element.tag) ? element.tag : undefined;
  const binding = element?.bindings[0];
  const variables = [
    ...new Set(
      (element?.variables ?? [])
        .map((variable) => variable.name)
        .filter((name) => !PASS_THROUGH_VARIABLES.has(name)),
    ),
  ];
  return {
    ...item,
    ask: askSentence(item, {
      component,
      prop: binding && (binding.spread ? 'className' : binding.prop),
      variables,
    }),
    comboDifferences: (entry?.result?.comboDifferences ?? []).map((difference) => ({
      combo: difference.combo,
      condition: difference.condition,
      summary: differenceSummary(difference.rootCauses),
    })),
    combos: (entry?.plan.combos ?? [{}]).map((combo, index) => ({
      index,
      label: comboLabel(combo),
    })),
    component,
    differingConditions: entry?.result?.differingConditions ?? [],
    errors: entry?.result?.errors ?? [],
    standIns,
    styles: stylesOf(entry, evidence, layout, moved),
    summary: differenceSummary(entry?.result?.rootCauses ?? []),
    title: titleOf(item.key, element),
  };
};

export type ReviewView = ReturnType<typeof describe>;

export const reviewState = async (stored: StoredRun) => {
  const verdict = await currentVerdict(stored);
  const reviews = await readRunReviews(stored);
  const resolved = resolvedReworks(verdict.items, reviews, new Date().toISOString());
  for (const rework of resolved) {
    await writeReviews(stored.recordsDir, rework.file, { reworks: [rework] });
    reviews.reworks.set(rework.key, rework);
  }
  const context = contextOf(stored);
  const items = reviewItems(verdict.items, reviews, context);
  return {
    context,
    items,
    reviews,
    verdict: resolved.length ? await currentVerdict(stored) : verdict,
  };
};

export const reviewPayload = async (stored: StoredRun, layoutComponents: string[] = []) => {
  const layout = new Set(layoutComponents);
  const { context, items, reviews, verdict } = await reviewState(stored);
  const views = items.map((item) =>
    describe(
      item,
      context.cases.get(item.key),
      context.elements.get(item.key),
      stored.evidence[item.key] as CaseEvidence | undefined,
      layout,
      standInsFor(item.key, context.cases.get(item.key), stored.plans ?? []),
      movedOf(
        stored,
        context.cases.get(item.key),
        stored.evidence[item.key] as CaseEvidence | undefined,
      ),
    ),
  );
  const resolved = [...reviews.reworks.values()].filter((rework) => rework.resolvedAt);
  return {
    conditions: (stored.run.conditions as string[] | undefined) ?? [],
    counts: {
      proven: stored.items.length - items.length,
      total: stored.items.length,
      ...Object.fromEntries(
        ['changed', 'passed', 'reworked', 'todo', 'waiting-agent'].map((state) => [
          state,
          items.filter((item) => item.state === state).length,
        ]),
      ),
    },
    items: views,
    pr: stored.run.pr,
    resolved: resolved.map(({ key, note, resolvedAt }) => ({ key, note, resolvedAt })),
    run: { base: stored.run.base, head: stored.run.head, runId: stored.run.runId },
    verdict: { mergeable: verdict.mergeable, reasons: verdict.reasons },
  };
};

export const caseReview = async (
  stored: StoredRun,
  key: string,
  layoutComponents: string[] = [],
) => {
  const { context, items, verdict } = await reviewState(stored);
  const queued = items.find((item) => item.key === key);
  const entry = verdict.items.find((item) => item.key === key);
  if (!queued && !entry) throw new ApiError(404, `UNKNOWN_CASE:${key}`);
  const item: ReviewItem = queued ?? {
    ...entry!,
    canPass: false,
    needsAgent: false,
    state: 'passed',
  };
  const caseEntry = context.cases.get(key);
  return {
    conditions: (stored.run.conditions as string[] | undefined) ?? [],
    item: describe(
      item,
      caseEntry,
      context.elements.get(key) ?? elementFor(stored, key, caseEntry),
      stored.evidence[key] as CaseEvidence | undefined,
      new Set(layoutComponents),
      standInsFor(key, caseEntry, stored.plans ?? []),
      movedOf(stored, caseEntry, stored.evidence[key] as CaseEvidence | undefined),
    ),
    queued: Boolean(queued),
  };
};

const failure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return new ApiError(message.startsWith('NOTE_REQUIRED') ? 400 : 409, message);
};

export const applyReview = async (
  stored: StoredRun,
  body: { action?: unknown; key?: unknown; note?: unknown; reviewer?: unknown },
) => {
  if (typeof body.key !== 'string' || (body.action !== 'pass' && body.action !== 'rework'))
    throw new ApiError(400, 'EXPECTED_KEY_AND_ACTION');
  const note = typeof body.note === 'string' ? body.note : '';
  const { context, items } = await reviewState(stored);
  const item = items.find((entry) => entry.key === body.key);
  if (!item) throw new ApiError(404, `UNKNOWN_CASE:${body.key}`);
  const reviewer =
    typeof body.reviewer === 'string' && body.reviewer
      ? body.reviewer
      : await defaultSigner(stored.run.repo ?? '.');
  const now = new Date().toISOString();
  try {
    if (body.action === 'pass') {
      const reworks: ReworkRecord[] = item.rework ? [{ ...item.rework, resolvedAt: now }] : [];
      await writeReviews(stored.recordsDir, item.file, {
        passes: [passRecord(item, note, reviewer, now)],
        reworks,
      });
    } else {
      const pr = runPr(stored);
      const view = describe(
        item,
        context.cases.get(item.key),
        context.elements.get(item.key),
        stored.evidence[item.key] as CaseEvidence | undefined,
      );
      const record = reworkRecord(
        item,
        {
          base: String(stored.run.base ?? ''),
          head: String(stored.run.head ?? ''),
          note: note.trim() ? note : defaultReworkNote(view),
          pr,
          reviewer,
          runId: String(stored.run.runId ?? ''),
          signature: context.signatures.get(item.key) ?? '',
        },
        now,
      );
      await writeReviews(stored.recordsDir, item.file, { reworks: [record] });
    }
  } catch (error) {
    throw failure(error);
  }
  return reviewPayload(stored);
};
