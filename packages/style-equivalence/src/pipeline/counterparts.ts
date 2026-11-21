import type { FileExtraction, RealComponent } from '../extract';
import { elementsOf } from '../plan/descendants';
import { chainOf, type FilePlan, type Side } from '../plan/planFile';
import { counterpartLeafOf } from '../source/counterpart';

export interface CounterpartSources {
  code: Partial<Record<Side, string>>;
  extractions: Record<Side, FileExtraction>;
  real?: Record<string, RealComponent>;
}

export const attachCounterparts = (plan: FilePlan, sources: CounterpartSources) => {
  for (const entry of plan.unpaired) {
    const other: Side = entry.side === 'base' ? 'head' : 'base';
    const from = sources.code[entry.side];
    const to = sources.code[other];
    if (!from || !to) continue;
    const byId = new Map(
      elementsOf(sources.extractions[entry.side]).map((element) => [element.id, element]),
    );
    const element = byId.get(entry.elementId);
    if (!element) continue;
    const leaf = counterpartLeafOf({
      expr: element.bindings[0]?.expr ?? '',
      from,
      owner: element.owner,
      real: sources.real,
      tag: element.tag,
      to,
    });
    if (!leaf) continue;
    const ancestors = chainOf(element, byId)
      .slice(0, -1)
      .flatMap(
        (item) =>
          plan.cases.find((planCase) => planCase.elementIds[entry.side] === item.id)?.elementIds[
            other
          ] ?? [],
      );
    entry.counterpart = { ancestors, ...leaf };
  }
};
