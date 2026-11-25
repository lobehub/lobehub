import { describe, expect, it, vi } from 'vitest';

const reached = vi.hoisted(() => new Set<string>());

vi.mock('@/services/artboard', () => {
  reached.add('@/services/artboard');
  return {};
});
vi.mock('@/libs/trpc/client', () => {
  reached.add('@/libs/trpc/client');
  return {};
});
vi.mock('@/features/Conversation/WorkingSidebar/Canvas/CanvasFrame', () => {
  reached.add('CanvasFrame');
  return { default: () => null };
});
vi.mock('@/features/Acceptance/Viewer/useAcceptanceBundle', () => {
  reached.add('useAcceptanceBundle');
  return {};
});
vi.mock('@xyflow/react', () => {
  reached.add('@xyflow/react');
  return {};
});

describe('artboard Viewport', () => {
  it('renders boards without loading app services, Canvas frames or acceptance data', async () => {
    await import('.');

    expect([...reached]).toEqual([]);
  });
});
