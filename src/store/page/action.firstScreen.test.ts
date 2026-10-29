import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { pageActions } from './action';
import { usePageStore } from './store';

const refreshDocsHome = vi.fn();

vi.mock('@/store/home', () => ({
  useHomeStore: { getState: () => ({ refreshDocsHome }) },
}));

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

vi.mock('@/services/document', () => ({
  documentService: { deleteDocument: vi.fn().mockResolvedValue(undefined) },
}));

const STORE_DIR = __dirname;

/** Every non-test module of the page store, recursively. */
const storeSources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return storeSources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });

describe('page store — first-screen imports', () => {
  // The page store is on the first screen. A static import of the home store
  // drags the chat store and the model bank into the entry chunk (+700 KB
  // gzip on the size gate), so those stores may only be loaded on demand.
  it.each(['@/store/home', '@/store/chat'])('does not statically import %s', (specifier) => {
    const staticImport = new RegExp(`^import(?!\\s+type)[^;]*from '${specifier}['/]`, 'm');
    const offenders = storeSources(STORE_DIR).filter((file) =>
      staticImport.test(readFileSync(file, 'utf8')),
    );

    expect(offenders.map((file) => path.relative(STORE_DIR, file))).toEqual([]);
  });

  it('still refreshes the Docs home after a page is removed', async () => {
    usePageStore.setState({ selectedPageId: null });

    await pageActions.removePage('docs_a');

    await vi.waitFor(() => expect(refreshDocsHome).toHaveBeenCalled());
  });
});
