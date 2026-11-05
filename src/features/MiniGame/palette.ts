/**
 * Pixel-art colors of the yard. They paint game artwork, not product chrome,
 * so they stay fixed across light and dark themes instead of using tokens.
 */
export const ART = {
  benchDark: '#8a5a32',
  benchLight: '#c98b4f',
  cabbage: '#7cc35b',
  cabbageDark: '#4f9a3c',
  door: '#7a4b2a',
  fish: '#f08a3c',
  fishFin: '#ffd27a',
  grass: '#9bd170',
  grassDark: '#8cc463',
  hair: '#4f7fe0',
  lampGlow: '#ffe8a3',
  lampPost: '#4b4f5c',
  leaf: '#5fae4f',
  leafDark: '#3f8a3a',
  lily: '#5cbf6a',
  outline: '#3b2f2a',
  pants: '#4b5878',
  pond: '#5fb4e6',
  pondDeep: '#3f8fcc',
  pondRim: '#c9e7f7',
  roof: '#c9573f',
  roofDark: '#9c3f2e',
  shirt: '#f4f1ea',
  skin: '#ffd9b8',
  soil: '#9a6a43',
  soilDark: '#7c5333',
  stone: '#b8b8b0',
  stoneDark: '#8f8f88',
  trunk: '#8a5a32',
  wall: '#f2dcb3',
  water: '#2f6fa8',
  windowLight: '#ffe58a',
} as const;

/** Pixel size of one grid cell inside the SVG viewBox. */
export const TILE = 32;
