import { describe, expect, it, vi } from 'vitest';

import { createEditorFileUploadTracker } from './editorFileUploadTracker';

describe('createEditorFileUploadTracker', () => {
  it('tracks progress for the pending editor node', () => {
    const tracker = createEditorFileUploadTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);

    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });
    const uploadId = tracker.start(file);
    listener.mockClear();
    tracker.bindNode('node-1', file.name);

    expect(listener).toHaveBeenCalledOnce();

    tracker.update(uploadId, 'uploading', { progress: 42, restTime: 8, speed: 1024 });

    expect(tracker.getSnapshot('node-1')).toEqual({
      file,
      id: uploadId,
      status: 'uploading',
      uploadState: { progress: 42, restTime: 8, speed: 1024 },
    });
  });

  it('binds progress when the pending editor node renders before the upload starts', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

    tracker.bindNode('node-1', file.name);
    const uploadId = tracker.start(file);
    tracker.update(uploadId, 'uploading', { progress: 42, restTime: 8, speed: 1024 });

    expect(tracker.getSnapshot('node-1')).toEqual({
      file,
      id: uploadId,
      status: 'uploading',
      uploadState: { progress: 42, restTime: 8, speed: 1024 },
    });
  });

  it('rebinds the same node after an effect cleanup while the upload is active', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });
    const uploadId = tracker.start(file);

    tracker.bindNode('node-1', file.name);
    tracker.releaseNode('node-1');
    tracker.bindNode('node-1', file.name);
    tracker.update(uploadId, 'uploading', { progress: 42, restTime: 8, speed: 1024 });

    expect(tracker.getSnapshot('node-1')?.uploadState?.progress).toBe(42);
  });

  it('keeps simultaneous files with the same name bound to separate editor nodes', () => {
    const tracker = createEditorFileUploadTracker();
    const firstFile = new File(['first'], 'recording.mp4', { type: 'video/mp4' });
    const secondFile = new File(['second'], 'recording.mp4', { type: 'video/mp4' });
    const firstUploadId = tracker.start(firstFile);
    const secondUploadId = tracker.start(secondFile);

    tracker.bindNode('node-1', firstFile.name);
    tracker.bindNode('node-2', secondFile.name);
    tracker.update(firstUploadId, 'uploading', { progress: 25, restTime: 10, speed: 100 });
    tracker.update(secondUploadId, 'uploading', { progress: 75, restTime: 3, speed: 300 });

    expect(tracker.getSnapshot('node-1')?.uploadState?.progress).toBe(25);
    expect(tracker.getSnapshot('node-2')?.uploadState?.progress).toBe(75);
  });

  it('does not bind a later node to a completed upload that rendered too quickly', () => {
    const tracker = createEditorFileUploadTracker();
    const firstFile = new File(['first'], 'recording.mp4', { type: 'video/mp4' });
    const secondFile = new File(['second'], 'recording.mp4', { type: 'video/mp4' });
    const firstUploadId = tracker.start(firstFile);
    tracker.finish(firstUploadId);
    const secondUploadId = tracker.start(secondFile);

    tracker.bindNode('node-2', secondFile.name);

    expect(tracker.getSnapshot('node-2')?.id).toBe(secondUploadId);
  });

  it('releases completed node state', () => {
    const tracker = createEditorFileUploadTracker();
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' });
    const uploadId = tracker.start(file);
    tracker.bindNode('node-1', file.name);
    tracker.finish(uploadId);

    tracker.releaseNode('node-1');

    const nextFile = new File(['next'], file.name, { type: file.type });
    const nextUploadId = tracker.start(nextFile);
    tracker.bindNode('node-2', nextFile.name);

    expect(tracker.getSnapshot('node-1')).toBeUndefined();
    expect(tracker.getSnapshot('node-2')?.id).toBe(nextUploadId);
  });
});
