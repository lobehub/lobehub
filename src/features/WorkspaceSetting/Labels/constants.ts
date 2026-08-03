/**
 * Preset label colors (Linear-inspired palette). Custom values are still
 * allowed through the form's free color input.
 */
export const LABEL_COLOR_PRESETS = [
  '#95999F', // gray
  '#4EA7FC', // blue
  '#26B5CE', // teal
  '#4CB782', // green
  '#F2C94C', // yellow
  '#F2994A', // orange
  '#F1573D', // red
  '#EB5A95', // pink
  '#B36BD4', // purple
  '#6771C5', // indigo
] as const;

export const DEFAULT_LABEL_COLOR = LABEL_COLOR_PRESETS[0];
