/**
 * LobeHub color scales, vendored from the "@lobehub/ui/color" entry point at v5.28.0.
 *
 * Copied rather than imported: this package is a dev-only CLI and the UI library would be
 * by far its heaviest dependency, in exchange for seven arrays of hex strings. Only the
 * scales the context map uses are kept.
 *
 * Each scale is the standard 13-step LobeHub ramp — 0 is the page background, 9 the solid
 * fill, 12 the highest-contrast text. Refresh by re-reading "@lobehub/ui/color" and
 * re-emitting this file; the step indices in contextMapPalette.ts stay valid.
 */

export interface ColorScale {
  dark: string[];
  light: string[];
}

export const blue: ColorScale = {
  dark: [
    '#000415',
    '#001740',
    '#00285b',
    '#003b79',
    '#004f98',
    '#0064b6',
    '#0d78ce',
    '#2d8ae0',
    '#439aed',
    '#60b1ff',
    '#a7d3ff',
    '#e0f0ff',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#fcfcff',
    '#f2f8ff',
    '#e5f1ff',
    '#d5e9ff',
    '#c2e0ff',
    '#acd4ff',
    '#93c8ff',
    '#76baff',
    '#57abf9',
    '#0d78ce',
    '#003b79',
    '#000415',
  ],
};

export const green: ColorScale = {
  dark: [
    '#000503',
    '#001d12',
    '#002d1d',
    '#003f28',
    '#005232',
    '#00653c',
    '#007944',
    '#1b8d4d',
    '#3ba05a',
    '#62c473',
    '#96cd92',
    '#cde6c3',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#f4fdeb',
    '#e7f8dd',
    '#d8f2ce',
    '#c7eabd',
    '#b4e1ac',
    '#a0d79b',
    '#89cc8a',
    '#71c179',
    '#379d4a',
    '#007944',
    '#003f28',
    '#000503',
  ],
};

export const orange: ColorScale = {
  dark: [
    '#070300',
    '#291900',
    '#462b00',
    '#684100',
    '#8e5900',
    '#b36f00',
    '#d18000',
    '#e88b00',
    '#f89200',
    '#ff9927',
    '#ffd1b1',
    '#fff1eb',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#fffcff',
    '#fff8f6',
    '#fff1eb',
    '#ffe9dd',
    '#ffdeca',
    '#ffd1b1',
    '#ffc293',
    '#ffb06a',
    '#f88c13',
    '#d18000',
    '#684100',
    '#070300',
  ],
};

export const purple: ColorScale = {
  dark: [
    '#0d000b',
    '#2e002a',
    '#42003e',
    '#560053',
    '#670e66',
    '#781e78',
    '#892b8a',
    '#9a399e',
    '#ab46b2',
    '#bd54c6',
    '#d590da',
    '#edc7ee',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#fff6fb',
    '#ffe7fd',
    '#fdd6fe',
    '#f6c4f8',
    '#eeb1f1',
    '#e49ce8',
    '#d886de',
    '#cb6ed2',
    '#bd54c6',
    '#892b8a',
    '#560053',
    '#0d000b',
  ],
};

export const red: ColorScale = {
  dark: [
    '#0f0003',
    '#380015',
    '#560023',
    '#780032',
    '#9d0042',
    '#c10251',
    '#d6225d',
    '#e43165',
    '#ee3a6a',
    '#f4416c',
    '#ffb0b7',
    '#ffe8e8',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#fffbff',
    '#fff3f3',
    '#ffe8e8',
    '#ffdadb',
    '#ffc7ca',
    '#ffb0b7',
    '#ff94a1',
    '#ff6f87',
    '#f4416c',
    '#d6225d',
    '#780032',
    '#0f0003',
  ],
};

export const sand: ColorScale = {
  dark: [
    '#000000',
    '#1c1c18',
    '#262521',
    '#30302b',
    '#3a3a35',
    '#45453f',
    '#505049',
    '#5c5b54',
    '#67675f',
    '#73726a',
    '#7f7e76',
    '#bcbab2',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#fcf9f3',
    '#edebe4',
    '#dfddd5',
    '#d1cfc7',
    '#c3c1b9',
    '#b5b3ab',
    '#a7a69d',
    '#999890',
    '#8c8b83',
    '#7f7e76',
    '#4b4a44',
    '#111',
  ],
};

export const slate: ColorScale = {
  dark: [
    '#000000',
    '#1b1c1d',
    '#242527',
    '#2e2f32',
    '#383a3c',
    '#434547',
    '#4e5052',
    '#595b5e',
    '#64676a',
    '#707276',
    '#7b7e82',
    '#b8babc',
    '#ffffff',
  ],
  light: [
    '#ffffff',
    '#f9f9fa',
    '#ebebec',
    '#dcddde',
    '#cecfd0',
    '#bfc1c3',
    '#b1b3b5',
    '#a4a6a8',
    '#96989b',
    '#898b8e',
    '#7b7e82',
    '#484a4d',
    '#111',
  ],
};
