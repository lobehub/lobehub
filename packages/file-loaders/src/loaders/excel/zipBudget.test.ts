import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';

import { buildTestZip } from './testUtils';
import { DEFAULT_XLSX_ZIP_LIMITS, preflightXlsxZip } from './zipBudget';

const limits = {
  maxEntries: 10,
  maxInputBytes: 100_000,
  maxTotalBytes: 1000,
  maxWorksheetBytes: 400,
};

const big = (n: number) => 'x'.repeat(n);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('preflightXlsxZip', () => {
  it('defaults to 64 MiB input, 5000 entries, 512 MiB total and 256 MiB per worksheet', () => {
    expect(DEFAULT_XLSX_ZIP_LIMITS).toEqual({
      maxEntries: 5000,
      maxInputBytes: 64 * 1024 * 1024,
      maxTotalBytes: 512 * 1024 * 1024,
      maxWorksheetBytes: 256 * 1024 * 1024,
    });
  });

  it('accepts a small normal archive (stored and deflated, with a directory)', async () => {
    const zip = buildTestZip([
      { data: '<a/>', name: 'xl/workbook.xml' },
      { data: big(300), deflate: true, name: 'xl/worksheets/sheet1.xml' },
      { name: 'xl/media/' },
    ]);

    await expect(preflightXlsxZip(zip, limits)).resolves.toBeUndefined();
  });

  it('is a no-op for data that is not a ZIP (legacy .xls / unknown)', async () => {
    await expect(
      preflightXlsxZip(Buffer.from('not a zip at all'), limits),
    ).resolves.toBeUndefined();
    await expect(preflightXlsxZip(Buffer.alloc(0), limits)).resolves.toBeUndefined();
    // Not a ZIP: the input budget is the caller's concern
    await expect(
      preflightXlsxZip(Buffer.alloc(200_000, 1), { ...limits, maxInputBytes: 10 }),
    ).resolves.toBeUndefined();
  });

  it('rejects a ZIP whose compressed input is over the input budget', async () => {
    const zip = buildTestZip([{ data: big(50), name: 'a.xml' }]);

    await expect(preflightXlsxZip(zip, { ...limits, maxInputBytes: 50 })).rejects.toMatchObject({
      actual: zip.length,
      limit: 50,
      name: 'FileParseBudgetError',
      reason: 'zip-input',
    });
  });

  it('rejects too many entries', async () => {
    const zip = buildTestZip(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.xml` })));

    await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({
      actual: 11,
      limit: 10,
      name: 'FileParseBudgetError',
      reason: 'zip-entries',
    });
  });

  it('rejects an honest archive whose total inflated size is over the budget', async () => {
    const zip = buildTestZip([
      { data: big(600), deflate: true, name: 'a.bin' },
      { data: big(600), deflate: true, name: 'b.bin' },
    ]);

    await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({
      limit: 1000,
      name: 'FileParseBudgetError',
      reason: 'zip-expansion',
    });
  });

  it('rejects a single worksheet over its budget', async () => {
    const zip = buildTestZip([{ data: big(401), deflate: true, name: 'xl/worksheets/sheet3.xml' }]);

    await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({
      actual: 401,
      limit: 400,
      name: 'FileParseBudgetError',
      reason: 'sheet-xml',
    });
  });

  it('does not apply the worksheet budget to other large parts', async () => {
    const zip = buildTestZip([{ data: big(900), deflate: true, name: 'xl/sharedStrings.xml' }]);

    await expect(preflightXlsxZip(zip, limits)).resolves.toBeUndefined();
  });

  it('keeps the budget error free of entry names', async () => {
    const zip = buildTestZip([{ data: big(500), deflate: true, name: 'xl/worksheets/SECRET.xml' }]);

    const error: any = await preflightXlsxZip(zip, limits).catch((e) => e);

    expect(error.name).toBe('FileParseBudgetError');
    expect(error.message).not.toContain('SECRET');
  });

  it('surfaces a truncated ZIP as an ordinary error, not a budget error', async () => {
    const zip = buildTestZip([{ data: 'x', name: 'a.xml' }]);
    const broken = zip.subarray(0, zip.length - 10);

    const error: any = await preflightXlsxZip(broken, limits).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).not.toBe('FileParseBudgetError');
  });

  describe('forged central directory', () => {
    it('rejects a deflated entry that inflates to more than it declares (a ZIP bomb lie)', async () => {
      // Declares 10 bytes but really inflates to 5000: a budget that only trusted the
      // declaration (limit 1000) would let this through.
      const zip = buildTestZip([
        { data: big(5000), declaredSize: 10, deflate: true, name: 'xl/worksheets/sheet1.xml' },
      ]);

      const error: any = await preflightXlsxZip(zip, limits).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).not.toBe('FileParseBudgetError');
      expect(error.message).toMatch(/too many bytes/);
    });

    it('rejects a deflated entry that inflates to less than it declares', async () => {
      const zip = buildTestZip([
        { data: big(50), declaredSize: 300, deflate: true, name: 'xl/worksheets/sheet1.xml' },
      ]);

      const error: any = await preflightXlsxZip(zip, limits).catch((e) => e);

      expect(error.message).toMatch(/not enough bytes/);
    });

    it('rejects a stored entry whose declared size disagrees with its stored size', async () => {
      const zip = buildTestZip([{ data: 'x', declaredSize: 9999, name: 'a.bin' }]);

      const error: any = await preflightXlsxZip(zip, limits).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).not.toBe('FileParseBudgetError');
    });

    it('rejects a declared worksheet size over budget before streaming anything', async () => {
      const zip = buildTestZip([
        { data: big(500), deflate: true, name: 'xl/worksheets/sheet1.xml' },
      ]);
      const open = vi.spyOn(yauzl.ZipFile.prototype, 'openReadStream');

      await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({ reason: 'sheet-xml' });
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('resources', () => {
    const captureHandles = () => {
      const handles: yauzl.ZipFile[] = [];
      const streams: Array<{ destroyed: boolean }> = [];
      const original = yauzl.fromBuffer.bind(yauzl);
      vi.spyOn(yauzl, 'fromBuffer').mockImplementation(((buffer: Buffer, opts: any, cb: any) =>
        original(buffer, opts, (err: Error | null, zipfile?: yauzl.ZipFile) => {
          if (zipfile) {
            handles.push(zipfile);
            const openRead = zipfile.openReadStream.bind(zipfile) as any;
            zipfile.openReadStream = ((entry: any, ...rest: any[]) => {
              const callback = rest.at(-1);
              return openRead(entry, ...rest.slice(0, -1), (e: any, stream: any) => {
                if (stream) streams.push(stream);
                callback(e, stream);
              });
            }) as any;
          }
          cb(err, zipfile);
        })) as any);
      return { handles, streams };
    };

    it.each([
      ['success', () => buildTestZip([{ data: big(100), deflate: true, name: 'a.xml' }])],
      [
        'too many entries',
        () => buildTestZip(Array.from({ length: 11 }, (_, i) => ({ name: `${i}` }))),
      ],
      [
        'declared expansion',
        () => buildTestZip([{ data: big(1500), deflate: true, name: 'a.bin' }]),
      ],
      [
        'declared worksheet',
        () => buildTestZip([{ data: big(500), deflate: true, name: 'xl/worksheets/s.xml' }]),
      ],
      [
        'forged larger real content',
        () => buildTestZip([{ data: big(5000), declaredSize: 10, deflate: true, name: 'a.bin' }]),
      ],
      [
        'forged smaller real content',
        () => buildTestZip([{ data: big(10), declaredSize: 900, deflate: true, name: 'a.bin' }]),
      ],
    ])('closes the ZIP handle and entry streams on %s', async (_name, make) => {
      const { handles, streams } = captureHandles();

      await preflightXlsxZip(make(), limits).catch(() => {});

      expect(handles).toHaveLength(1);
      expect(handles[0].isOpen).toBe(false);
      for (const stream of streams) expect(stream.destroyed).toBe(true);
    });

    it('aborts on the actually inflated bytes and closes the active stream and zip', async () => {
      // A reader that misreports: declared 10 bytes but the stream yields far more. Chunks
      // are counted, the stream is destroyed at the first chunk over budget, nothing is kept.
      const stream = new PassThrough();
      const zipfile: any = new EventEmitter();
      zipfile.entryCount = 1;
      zipfile.isOpen = true;
      zipfile.close = vi.fn(() => {
        zipfile.isOpen = false;
      });
      zipfile.readEntry = vi.fn(() =>
        setImmediate(() =>
          zipfile.emit('entry', { fileName: 'xl/worksheets/s.xml', uncompressedSize: 10 }),
        ),
      );
      zipfile.openReadStream = vi.fn((_entry: unknown, cb: any) => {
        cb(null, stream);
        stream.write(Buffer.alloc(500));
      });
      vi.spyOn(yauzl, 'fromBuffer').mockImplementation(((_b: any, _o: any, cb: any) =>
        cb(null, zipfile)) as any);

      const zip = buildTestZip([{ data: 'x', name: 'a.xml' }]);
      await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({
        actual: 500,
        limit: 400,
        name: 'FileParseBudgetError',
        reason: 'sheet-xml',
      });

      expect(stream.destroyed).toBe(true);
      expect(zipfile.close).toHaveBeenCalledTimes(1);
      expect(zipfile.isOpen).toBe(false);
    });

    it('aborts when the total of actually inflated bytes crosses the budget', async () => {
      const streams: PassThrough[] = [];
      const zipfile: any = new EventEmitter();
      zipfile.entryCount = 3;
      zipfile.isOpen = true;
      zipfile.close = vi.fn();
      let next = 0;
      zipfile.readEntry = vi.fn(() =>
        setImmediate(() =>
          zipfile.emit('entry', { fileName: `p${next++}.bin`, uncompressedSize: 10 }),
        ),
      );
      zipfile.openReadStream = vi.fn((_entry: unknown, cb: any) => {
        const stream = new PassThrough();
        streams.push(stream);
        cb(null, stream);
        stream.write(Buffer.alloc(600));
        stream.end();
      });
      vi.spyOn(yauzl, 'fromBuffer').mockImplementation(((_b: any, _o: any, cb: any) =>
        cb(null, zipfile)) as any);

      const zip = buildTestZip([{ data: 'x', name: 'a.xml' }]);
      await expect(preflightXlsxZip(zip, limits)).rejects.toMatchObject({
        limit: 1000,
        reason: 'zip-expansion',
      });

      expect(streams).toHaveLength(2);
      expect(streams.every((s) => s.destroyed)).toBe(true);
      expect(zipfile.close).toHaveBeenCalledTimes(1);
    });
  });
});
