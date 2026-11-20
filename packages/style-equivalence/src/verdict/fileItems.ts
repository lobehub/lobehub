import type { FileExtraction } from '../extract';
import type { FilePlan, Side } from '../plan/planFile';

export const STYLE_OUTSIDE_JSX = 'STYLE_OUTSIDE_JSX';

export const fileItemKey = (file: string) => `${file}|file`;

export const fileFlags = (
  plan: Pick<FilePlan, 'gaps'>,
  pair: Partial<Record<Side, Pick<FileExtraction, 'outsideReferences'>>>,
) => [
  ...plan.gaps,
  ...((['base', 'head'] as const).some((side) => pair[side]?.outsideReferences.length)
    ? [STYLE_OUTSIDE_JSX]
    : []),
];
