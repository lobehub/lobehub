import { BRANDING_NAME, ORG_NAME } from '@lobechat/business-const';

// type-only: loads ./global.d.ts so `__ELECTRON__` exists even when this
// package is compiled from a workspace without the app's ambient declarations
import type {} from './global';

/** Panachat/Aico product SemVer shown in Settings → About (not LobeHub package.json). */
export const AICO_PRODUCT_VERSION = '0.9.1';

export const CURRENT_VERSION = AICO_PRODUCT_VERSION;

export const isDesktop = typeof __ELECTRON__ !== 'undefined' && !!__ELECTRON__;

// @ts-ignore
export const isCustomBranding = BRANDING_NAME !== 'LobeHub';
// @ts-ignore
export const isCustomORG = ORG_NAME !== 'LobeHub';
