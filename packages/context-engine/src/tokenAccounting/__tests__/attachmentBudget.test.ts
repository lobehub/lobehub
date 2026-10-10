import type { ChatFileItem, UIChatMessage } from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { planAttachmentPreviews } from '../attachmentBudget';
import { DEFAULT_DRIFT_MULTIPLIER } from '../index';

const paper = (seed: string) =>
  `${seed}: salt gland development in Limonium bicolor under saline stress. `.repeat(600);

const mkFile = (id: string, content: string): ChatFileItem => ({
  content,
  fileType: 'application/pdf',
  id,
  name: `${id}.pdf`,
  size: content.length,
  url: `https://example.com/${id}.pdf`,
});

const mkUser = (id: string, files: ChatFileItem[]): UIChatMessage =>
  ({
    content: `summarize ${id}`,
    createdAt: 0,
    fileList: files,
    id,
    role: 'user',
    updatedAt: 0,
  }) as UIChatMessage;

const paperTokens = estimateTokenCount(paper('p'));
/** Room for about `papers` full papers, drift included. */
const thresholdFor = (papers: number) => Math.ceil(paperTokens * papers * DEFAULT_DRIFT_MULTIPLIER);

describe('planAttachmentPreviews', () => {
  it('previews nothing when every attachment fits', () => {
    const messages = [mkUser('m1', [mkFile('f1', paper('a'))])];

    const plan = planAttachmentPreviews({ messages, threshold: thresholdFor(3) });

    expect(plan.previewFileIds.size).toBe(0);
  });

  // Regression: LOBE-14165. Attachment text must not push the request over the
  // compression threshold, because compression drops older attachments.
  it('inlines the newest attachments and previews older ones within the threshold', () => {
    const messages = [
      mkUser('m1', [mkFile('f1', paper('a'))]),
      mkUser('m2', [mkFile('f2', paper('b'))]),
      mkUser('m3', [mkFile('f3', paper('c'))]),
    ];
    const threshold = thresholdFor(1.6);

    const plan = planAttachmentPreviews({ messages, threshold });

    expect([...plan.previewFileIds].sort()).toEqual(['f1', 'f2']);
    expect(plan.accounting.adjustedTotal).toBeLessThanOrEqual(threshold);
  });

  it('fills leftover room with an older attachment when a newer one does not fit', () => {
    const messages = [
      mkUser('m1', [mkFile('small', paper('a').slice(0, 20_000))]),
      mkUser('m2', [mkFile('big', paper('b') + paper('c'))]),
    ];
    const threshold = thresholdFor(0.8);

    const plan = planAttachmentPreviews({ messages, threshold });

    expect([...plan.previewFileIds]).toEqual(['big']);
    expect(plan.accounting.adjustedTotal).toBeLessThanOrEqual(threshold);
  });

  it('never previews attachments shorter than a preview', () => {
    const short = 'tiny note';
    const messages = [
      mkUser('m1', [mkFile('short', short)]),
      mkUser('m2', [mkFile('f2', paper('b'))]),
    ];

    const plan = planAttachmentPreviews({ messages, threshold: thresholdFor(0.2) });

    expect(plan.previewFileIds.has('short')).toBe(false);
    expect(plan.previewFileIds.has('f2')).toBe(true);
  });

  it('previews every candidate and reports the overflow when text alone exceeds the threshold', () => {
    const messages = [
      { ...mkUser('m1', [mkFile('f1', paper('a'))]), content: paper('chat').repeat(3) },
      mkUser('m2', [mkFile('f2', paper('b'))]),
    ] as UIChatMessage[];
    const threshold = thresholdFor(1);

    const plan = planAttachmentPreviews({ messages, threshold });

    expect([...plan.previewFileIds].sort()).toEqual(['f1', 'f2']);
    expect(plan.accounting.adjustedTotal).toBeGreaterThan(threshold);
  });
});
