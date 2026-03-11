import type { Plugin } from 'vite';

/**
 * Forces emotion's speedy mode in antd-style.
 *
 * antd-style hardcodes `speedy: false` in both createStaticStyles and
 * createInstance, which causes emotion to create a new <style> element
 * for every CSS rule (n % 1 === 0 is always true).
 * With speedy: true, one <style> tag holds up to 65 000 rules via
 * CSSStyleSheet.insertRule(), eliminating thousands of DOM insertBefore calls.
 */
export function viteEmotionSpeedy(): Plugin {
  return {
    name: 'emotion-speedy',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('antd-style') && code.includes('speedy: false')) {
        return {
          code: code.replaceAll('speedy: false', 'speedy: true'),
          map: null,
        };
      }
    },
  };
}
