// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadFile } from '../src';

const getFixturePath = (filename: string) => path.join(__dirname, 'fixtures', filename);

const TEXT_FILES = ['test.txt', 'test.csv', 'test.md'];

describe('loadFile Integration Tests', () => {
  describe('Text Handling (.txt, .csv, .md, etc.)', () => {
    const testPureTextFile = (fileName: string) => {
      it(`should load content from a ${fileName} file using filePath`, async () => {
        const filePath = getFixturePath(fileName);
        const expectedContent = fs.readFileSync(filePath, 'utf8');

        // Pass filePath directly to loadFile
        const docs = await loadFile(filePath);

        expect(docs.content).toEqual(expectedContent);
        expect(docs.source).toEqual(filePath);

        // @ts-expect-error
        delete docs.source;
        // @ts-expect-error
        delete docs.createdTime;
        // @ts-expect-error
        delete docs.modifiedTime;
        expect(docs).toMatchSnapshot();
      });
    };

    TEXT_FILES.forEach((file) => {
      testPureTextFile(file);
    });
  });

  describe('PDF Handling', () => {
    it(`should load content from a pdf file using filePath`, async () => {
      const filePath = getFixturePath('test.pdf');

      // Pass filePath directly to loadFile
      const docs = await loadFile(filePath);

      expect(docs.content).toContain('123');
      expect(docs.source).toEqual(filePath);

      // @ts-expect-error
      delete docs.source;
      // @ts-expect-error
      delete docs.createdTime;
      // @ts-expect-error
      delete docs.modifiedTime;
      expect(docs).toMatchSnapshot();
    });
  });
});
