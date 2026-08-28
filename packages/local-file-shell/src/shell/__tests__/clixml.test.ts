import { describe, expect, it } from 'vitest';

import { decodeClixml } from '../clixml';

/** PS 5.1-style error stream serialization. */
const ERROR_BLOCK =
  '#< CLIXML\n' +
  '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
  '<S S="Error">boom : command failed_x000D__x000A_</S>' +
  '<S S="Error">    + CategoryInfo          : NotSpecified_x000D__x000A_</S>' +
  '</Objs>';

/** pwsh 7 Write-Host → InformationRecord serialization (no stream-typed <S>). */
const INFORMATION_BLOCK =
  '#< CLIXML\n' +
  '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
  '<Obj S="information" RefId="0"><TN RefId="0">' +
  '<T>System.Management.Automation.InformationRecord</T><T>System.Object</T></TN>' +
  '<ToString>=== 1. CMD: C:\\Users\\jalen ===</ToString>' +
  '<Props><Obj N="MessageData" RefId="1"><TN RefId="1">' +
  '<T>System.Management.Automation.HostInformationMessage</T><T>System.Object</T></TN>' +
  '<ToString>=== 1. CMD: C:\\Users\\jalen ===</ToString>' +
  '<Props><S N="Message">=== 1. CMD: C:\\Users\\jalen ===</S>' +
  '<B N="NoNewLine">false</B></Props></Obj></Props></Obj>' +
  '</Objs>';

describe('decodeClixml', () => {
  it('should return text without a CLIXML marker unchanged', () => {
    expect(decodeClixml('plain stderr output')).toBe('plain stderr output');
  });

  it('should decode error-stream entries and unescape control characters', () => {
    const decoded = decodeClixml(ERROR_BLOCK);

    expect(decoded).toContain('boom : command failed\r\n');
    expect(decoded).toContain('+ CategoryInfo          : NotSpecified\r\n');
    expect(decoded).not.toContain('CLIXML');
    expect(decoded).not.toContain('<Objs');
  });

  it('should decode Write-Host information records via ToString and collapse duplicates', () => {
    const decoded = decodeClixml(INFORMATION_BLOCK);

    expect(decoded).toBe('=== 1. CMD: C:\\Users\\jalen ===\n');
  });

  it('should preserve plain text around CLIXML blocks', () => {
    const decoded = decodeClixml(`before\n${ERROR_BLOCK}after`);

    expect(decoded.startsWith('before\n')).toBe(true);
    expect(decoded.endsWith('after')).toBe(true);
    expect(decoded).toContain('boom : command failed');
  });

  it('should decode a truncated block without the closing tag', () => {
    const truncated = ERROR_BLOCK.slice(0, ERROR_BLOCK.indexOf('</Objs>'));
    const decoded = decodeClixml(truncated);

    expect(decoded).toContain('boom : command failed');
    expect(decoded).not.toContain('<Objs');
  });

  it('should unescape XML entities', () => {
    const block =
      '#< CLIXML\n<Objs Version="1.1.0.1"><S S="Error">a &lt; b &amp;&amp; c &gt; d</S></Objs>';

    expect(decodeClixml(block)).toBe('a < b && c > d\n');
  });
});
