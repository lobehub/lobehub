import { describe, expect, it } from 'vitest';

import { injectDialogInterceptor } from './dialogInterceptor';

describe('injectDialogInterceptor', () => {
  it('should return empty/falsy inputs unmodified', () => {
    expect(injectDialogInterceptor('')).toBe('');
  });

  it('should inject right after <head> tag if present', () => {
    const html = '<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
    const result = injectDialogInterceptor(html);
    expect(result.includes('<html><head>\n<script>')).toBe(true);
    expect(result.includes('window.alert = function')).toBe(true);
    expect(result.endsWith('</head><body><h1>Hello</h1></body></html>')).toBe(true);
  });

  it('should inject right after <html> tag if <head> is missing but <html> is present', () => {
    const html = '<html><body><h1>Hello</h1></body></html>';
    const result = injectDialogInterceptor(html);
    expect(result.includes('<html>\n<script>')).toBe(true);
    expect(result.includes('window.alert = function')).toBe(true);
    expect(result.endsWith('<body><h1>Hello</h1></body></html>')).toBe(true);
  });

  it('should prepend script if neither <head> nor <html> tags are present', () => {
    const html = '<div>Hello World</div>';
    const result = injectDialogInterceptor(html);
    expect(result.startsWith('\n<script>')).toBe(true);
    expect(result.includes('window.alert = function')).toBe(true);
    expect(result.endsWith('<div>Hello World</div>')).toBe(true);
  });
});
