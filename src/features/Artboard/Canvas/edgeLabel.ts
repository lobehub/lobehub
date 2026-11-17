import { textWidth } from './boardLabelLayout';

export const EDGE_LABEL_FONT = 32;
const EDGE_BRANCH_FONT = 28;
const MIN_SCREEN_FONT = 11;
export const EDGE_LABEL_PAD = 16;
export const EDGE_LABEL_MAX_WIDTH = 360;
export const EDGE_LABEL_HEIGHT = 45;
const MIN_SCREEN_ROOM = 40;
const MIN_RESTING_ZOOM = 0.25;
const MIN_LINKED_ZOOM = 0.3;

export const edgeLabelText = (edge: { condition: string | null; label: string }) =>
  [edge.label, edge.condition].filter(Boolean).join(' · ');

export const edgeLabelWidth = (text: string) =>
  textWidth(text, EDGE_LABEL_FONT) + EDGE_LABEL_PAD * 2;

export const edgeLabelFont = (k: number, branch: boolean) =>
  Math.max(branch ? EDGE_BRANCH_FONT : EDGE_LABEL_FONT, MIN_SCREEN_FONT / k);

export type EdgeLabelMode = 'full' | 'inline' | 'none';

interface EdgeLabelInput {
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
  return k >= MIN_RESTING_ZOOM && room * k - EDGE_LABEL_PAD >= MIN_SCREEN_ROOM ? 'inline' : 'none';
};
