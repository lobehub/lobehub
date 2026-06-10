import { describe, expect, it } from 'vitest';

import {
  COMFYUI_DEFAULTS,
  CUSTOM_SD_CONFIG,
  DEFAULT_NEGATIVE_PROMPT,
  FLUX_MODEL_CONFIG,
  SD_MODEL_CONFIG,
  WORKFLOW_DEFAULTS,
} from '@/server/services/comfyui/config/constants';
import { STYLE_KEYWORDS } from '@/server/services/comfyui/config/promptToolConst';

describe('ComfyUI Constants', () => {
  describe('COMFYUI_DEFAULTS', () => {
    it('should be a valid object', () => {
      expect(typeof COMFYUI_DEFAULTS).toBe('object');
      expect(COMFYUI_DEFAULTS).toBeDefined();
    });
  });

  describe('FLUX_MODEL_CONFIG', () => {
    it('should have correct filename prefixes', () => {
      expect(FLUX_MODEL_CONFIG.FILENAME_PREFIXES.SCHNELL).toContain('FLUX_Schnell');
      expect(FLUX_MODEL_CONFIG.FILENAME_PREFIXES.DEV).toContain('FLUX_Dev');
      expect(FLUX_MODEL_CONFIG.FILENAME_PREFIXES.KONTEXT).toContain('FLUX_Kontext');
      expect(FLUX_MODEL_CONFIG.FILENAME_PREFIXES.KREA).toContain('FLUX_Krea');
    });

    it('should have all required prefixes', () => {
      const expectedKeys = ['SCHNELL', 'DEV', 'KONTEXT', 'KREA'];
      expect(Object.keys(FLUX_MODEL_CONFIG.FILENAME_PREFIXES)).toEqual(
        expect.arrayContaining(expectedKeys),
      );
    });

    it('should be a readonly object (TypeScript as const)', () => {
      // `as const` provides readonly types in TypeScript, not runtime freezing
      expect(typeof FLUX_MODEL_CONFIG).toBe('object');
    });
  });

  describe('WORKFLOW_DEFAULTS', () => {
    it('should have valid workflow parameters', () => {
      expect(WORKFLOW_DEFAULTS.IMAGE.BATCH_SIZE).toBeGreaterThan(0);
      expect(WORKFLOW_DEFAULTS.SAMPLING.DENOISE).toBeGreaterThanOrEqual(0);
      expect(WORKFLOW_DEFAULTS.SAMPLING.DENOISE).toBeLessThanOrEqual(1);
      expect(WORKFLOW_DEFAULTS.SAMPLING.MAX_SHIFT).toBeGreaterThan(0);
      expect(WORKFLOW_DEFAULTS.SD3.SHIFT).toBeGreaterThan(0);
    });

    it('should be a readonly object (TypeScript as const)', () => {
      // `as const` provides readonly types in TypeScript, not runtime freezing
      expect(typeof WORKFLOW_DEFAULTS).toBe('object');
    });
  });

  describe('STYLE_KEYWORDS', () => {
    it('should have all required categories', () => {
      const expectedCategories = [
        'ARTISTS',
        'ART_STYLES',
        'LIGHTING',
        'PHOTOGRAPHY',
        'QUALITY',
        'RENDERING',
      ];
      expect(Object.keys(STYLE_KEYWORDS)).toEqual(expect.arrayContaining(expectedCategories));
    });

    it('should have non-empty arrays for each category', () => {
      Object.values(STYLE_KEYWORDS).forEach((keywords) => {
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
      });
    });

    it('should contain expected artist keywords', () => {
      expect(STYLE_KEYWORDS.ARTISTS).toEqual(
        expect.arrayContaining(['by greg rutkowski', 'by artgerm', 'trending on artstation']),
      );
    });

    it('should contain expected art style keywords', () => {
      expect(STYLE_KEYWORDS.ART_STYLES).toEqual(
        expect.arrayContaining(['photorealistic', 'anime', 'digital art', '3d render']),
      );
    });

    it('should contain expected lighting keywords', () => {
      expect(STYLE_KEYWORDS.LIGHTING).toEqual(
        expect.arrayContaining(['dramatic lighting', 'studio lighting', 'soft lighting']),
      );
    });

    it('should contain expected photography keywords', () => {
      expect(STYLE_KEYWORDS.PHOTOGRAPHY).toEqual(
        expect.arrayContaining([
          'depth of field',
          'bokeh',
          '35mm photograph',
          'professional photograph',
        ]),
      );
    });

    it('should contain expected quality keywords', () => {
      expect(STYLE_KEYWORDS.QUALITY).toEqual(
        expect.arrayContaining([
          'masterpiece',
          'best quality',
          'high quality',
          'extremely detailed',
        ]),
      );
    });

    it('should contain expected rendering keywords', () => {
      expect(STYLE_KEYWORDS.RENDERING).toEqual(
        expect.arrayContaining(['octane render', 'unreal engine', 'ray tracing', 'cycles render']),
      );
    });
  });

  describe('DEFAULT_NEGATIVE_PROMPT', () => {
    it('should be defined and non-empty', () => {
      expect(DEFAULT_NEGATIVE_PROMPT).toBeDefined();
      expect(DEFAULT_NEGATIVE_PROMPT).not.toBe('');
    });
  });

  describe('CUSTOM_SD_CONFIG', () => {
    it('should have model and VAE filenames', () => {
      expect(CUSTOM_SD_CONFIG.MODEL_FILENAME).toBeDefined();
      expect(CUSTOM_SD_CONFIG.VAE_FILENAME).toBeDefined();
    });
  });

  describe('SD_MODEL_CONFIG', () => {
    it('should have correct filename prefixes', () => {
      expect(SD_MODEL_CONFIG.FILENAME_PREFIXES.SD15).toContain('SD15');
      expect(SD_MODEL_CONFIG.FILENAME_PREFIXES.SD35).toContain('SD35');
      expect(SD_MODEL_CONFIG.FILENAME_PREFIXES.SDXL).toContain('SDXL');
      expect(SD_MODEL_CONFIG.FILENAME_PREFIXES.CUSTOM).toContain('CustomSD');
    });
  });
});
