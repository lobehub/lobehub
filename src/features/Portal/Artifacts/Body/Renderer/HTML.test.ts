import { describe, expect, it } from 'vitest';

import { injectSandboxStorageShim } from './HTML';

describe('injectSandboxStorageShim', () => {
  it('should inject the storage shim before user scripts in head', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <script>localStorage.getItem('snakeHighScore');</script>
</head>
<body></body>
</html>`;

    const result = injectSandboxStorageShim(html);

    expect(result.indexOf('data-lobe-artifact-storage-shim')).toBeGreaterThan(-1);
    expect(result.indexOf('data-lobe-artifact-storage-shim')).toBeLessThan(
      result.indexOf("localStorage.getItem('snakeHighScore')"),
    );
  });

  it('should not inject the storage shim twice', () => {
    const html = '<html><head></head><body></body></html>';
    const result = injectSandboxStorageShim(injectSandboxStorageShim(html));

    expect(result.match(/data-lobe-artifact-storage-shim/g)).toHaveLength(1);
  });
});
