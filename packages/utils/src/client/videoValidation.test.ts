import { describe, expect, it } from 'vitest';

import { validateVideoFileSize } from './videoValidation';

const createMockFile = (size: number, type: string): File => ({ size, type }) as File;

describe('validateVideoFileSize', () => {
  it('should return valid for non-video files', () => {
    const mockFile = createMockFile(4, 'text/plain');
    const result = validateVideoFileSize(mockFile);

    expect(result.isValid).toBe(true);
    expect(result.actualSize).toBeUndefined();
    expect(result.maxSize).toBeUndefined();
  });

  it('should return valid for video files under 100MB', () => {
    const mockVideoFile = createMockFile(10 * 1024 * 1024, 'video/mp4');
    const result = validateVideoFileSize(mockVideoFile);

    expect(result.isValid).toBe(true);
    expect(result.actualSize).toBe('10.0 MB');
  });

  it('should return valid for video files under 100MB (25MB)', () => {
    const mockLargeVideoFile = createMockFile(25 * 1024 * 1024, 'video/mp4');
    const result = validateVideoFileSize(mockLargeVideoFile);

    expect(result.isValid).toBe(true);
    expect(result.actualSize).toBe('25.0 MB');
  });

  it('should return invalid for video files over 100MB', () => {
    const mockLargeVideoFile = createMockFile(120 * 1024 * 1024, 'video/mp4');
    const result = validateVideoFileSize(mockLargeVideoFile);

    expect(result.isValid).toBe(false);
    expect(result.actualSize).toBe('120.0 MB');
    expect(result.maxSize).toBe('100.0 MB');
  });

  it('should return invalid for video files exactly at 100MB limit plus 1 byte', () => {
    const mockBoundaryFile = createMockFile(100 * 1024 * 1024 + 1, 'video/mp4');
    const result = validateVideoFileSize(mockBoundaryFile);

    expect(result.isValid).toBe(false);
    expect(result.actualSize).toBe('100.0 MB');
  });

  it('should return valid for video files exactly at 100MB limit', () => {
    const mockBoundaryFile = createMockFile(100 * 1024 * 1024, 'video/mp4');
    const result = validateVideoFileSize(mockBoundaryFile);

    expect(result.isValid).toBe(true);
    expect(result.actualSize).toBe('100.0 MB');
  });
});
