/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';

import { confirmRemoveTopic } from './index';

const confirmModalMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: confirmModalMock,
}));

vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

describe('confirmRemoveTopic', () => {
  beforeEach(() => {
    confirmModalMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('hides the file option but keeps cleanup enabled when topics have no files', async () => {
    vi.spyOn(topicService, 'hasTopicFiles').mockResolvedValue(false);
    const onConfirm = vi.fn();

    await confirmRemoveTopic({ onConfirm, topicIds: ['topic-1'] });

    const config = confirmModalMock.mock.calls[0][0];
    expect(config.content.props.showRemoveFiles).toBe(false);

    // Files attached between the precheck snapshot and confirm must still be
    // cleaned up, so the hidden state confirms with removal enabled.
    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('shows the file option and defaults to file removal when a selected topic has files', async () => {
    vi.spyOn(topicService, 'hasTopicFiles').mockResolvedValue(true);
    const onConfirm = vi.fn();

    await confirmRemoveTopic({ onConfirm, topicIds: ['topic-1', 'topic-2'] });

    const config = confirmModalMock.mock.calls[0][0];
    expect(config.content.props.showRemoveFiles).toBe(true);

    await config.onOk();
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('shows the file option when attachment presence cannot be determined', async () => {
    vi.spyOn(topicService, 'hasTopicFiles').mockRejectedValue(new Error('lookup failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await confirmRemoveTopic({ onConfirm: vi.fn(), topicIds: ['topic-1'] });

    const config = confirmModalMock.mock.calls[0][0];
    expect(config.content.props.showRemoveFiles).toBe(true);
  });

  it('opens the conservative file option when the lookup exceeds 500ms', async () => {
    vi.useFakeTimers();
    vi.spyOn(topicService, 'hasTopicFiles').mockReturnValue(new Promise(() => {}));

    const confirmation = confirmRemoveTopic({ onConfirm: vi.fn(), topicIds: ['topic-1'] });
    expect(confirmModalMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await confirmation;

    const config = confirmModalMock.mock.calls[0][0];
    expect(config.content.props.showRemoveFiles).toBe(true);
  });
});
