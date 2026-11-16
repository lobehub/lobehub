export const EDGE_LABEL_FONT = 20;
/** Inline labels never grow past this: the full text stays on hover/selection. */
export const EDGE_LABEL_MAX_WIDTH = 220;
/** Single-line label box height at {@link EDGE_LABEL_FONT} (line-height 1.2). */
export const EDGE_LABEL_HEIGHT = 24;
const MIN_READABLE_FONT = 9;
const MIN_ROOM = 48;
const MIN_LINKED_ZOOM = 0.3;

export const edgeLabelText = (edge: { condition: string | null; label: string }) =>
  [edge.label, edge.condition].filter(Boolean).join(' · ');

const WIDE_CHAR =
  /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Rendered width of a single-line label, without a DOM measurement. */
export const edgeLabelWidth = (text: string) => {
  let units = 0;
  for (const char of text) units += WIDE_CHAR.test(char) ? 1 : 0.55;
  return units * EDGE_LABEL_FONT;
};

export type EdgeLabelMode = 'full' | 'inline' | 'none';

interface EdgeLabelInput {
  /** Layout found no free slot: only an explicit hover/selection reveals it. */
  crowded?: boolean;
  hovered: boolean;
  k: number;
  linked: boolean;
  room: number;
  text: string;
}

export const edgeLabelMode = ({
  crowded,
  hovered,
  k,
  linked,
  room,
  text,
}: EdgeLabelInput): EdgeLabelMode => {
  if (!text) return 'none';
  if (hovered || (linked && k >= MIN_LINKED_ZOOM)) return 'full';
  if (crowded) return 'none';
  return EDGE_LABEL_FONT * k >= MIN_READABLE_FONT && room >= MIN_ROOM ? 'inline' : 'none';
};
