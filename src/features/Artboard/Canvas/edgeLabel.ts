export const EDGE_LABEL_FONT = 20;
const MIN_READABLE_FONT = 9;
const MIN_ROOM = 48;
const MIN_LINKED_ZOOM = 0.3;

export const edgeLabelText = (edge: { condition: string | null; label: string }) =>
  [edge.label, edge.condition].filter(Boolean).join(' · ');

export type EdgeLabelMode = 'full' | 'inline' | 'none';

interface EdgeLabelInput {
  hovered: boolean;
  k: number;
  linked: boolean;
  room: number;
  text: string;
}

export const edgeLabelMode = ({
  hovered,
  k,
  linked,
  room,
  text,
}: EdgeLabelInput): EdgeLabelMode => {
  if (!text) return 'none';
  if (hovered || (linked && k >= MIN_LINKED_ZOOM)) return 'full';
  return EDGE_LABEL_FONT * k >= MIN_READABLE_FONT && room >= MIN_ROOM ? 'inline' : 'none';
};
