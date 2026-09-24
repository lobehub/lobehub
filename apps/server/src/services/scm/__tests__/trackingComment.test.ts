import { describe, expect, it } from 'vitest';

import {
  buildTrackingComment,
  encodeTrackingMarker,
  formatUtc,
  parseTrackingMarker,
} from '../trackingComment';

const marker = {
  acceptanceId: '1042abc6-4d38-49a6-b4b9-5c5a606d762e',
  changeRequestId: 'scr_1',
  provider: 'github' as const,
  topicId: 'tpc_1',
  v: 1 as const,
};

describe('tracking comment', () => {
  it('hides the identity in a link reference definition that round-trips', () => {
    const body = buildTrackingComment({ marker, updatedAt: new Date('2026-09-20T15:12:00Z') });
    expect(body.startsWith('[lobehub]: #')).toBe(true);
    expect(parseTrackingMarker(body)).toEqual(marker);
    expect(parseTrackingMarker('just a comment')).toBeNull();
    expect(parseTrackingMarker('[lobehub]: #not-base64-json')).toBeNull();
    expect(encodeTrackingMarker(marker)).not.toContain('scr_1');
  });

  it('renders a status table with the acceptance, conversation and notifications', () => {
    const body = buildTrackingComment({
      acceptance: {
        id: marker.acceptanceId,
        status: 'delivered',
        url: 'https://app.test/acceptance/1042abc6-4d38-49a6-b4b9-5c5a606d762e',
      },
      conversation: { title: 'Fix | the thing\nnow', url: 'https://app.test/agent/a/tpc_1' },
      marker,
      notification: { count: 1, max: 3, reason: 'ci_failed' },
      updatedAt: new Date('2026-09-20T15:12:00Z'),
    });

    expect(body).toContain('**LobeHub is tracking this pull request.**');
    expect(body).toContain(
      '| Acceptance | Status | Conversation | Notifications | Updated (UTC) |',
    );
    expect(body).toContain(
      '| [1042abc6](https://app.test/acceptance/1042abc6-4d38-49a6-b4b9-5c5a606d762e) | 🟡 Delivered | [Fix \\| the thing now ↗︎](https://app.test/agent/a/tpc_1) | 1/3 · CI failed | Sep 20, 2026 3:12pm |',
    );
  });

  it('keeps a hostile conversation title inside its own link label', () => {
    const body = buildTrackingComment({
      conversation: {
        title: '](https://evil.example) [click me',
        url: 'https://app.test/agent/a/tpc_1',
      },
      marker,
      updatedAt: new Date('2026-09-20T15:12:00Z'),
    });

    // The title is a user- or model-written string on a public pull
    // request: unescaped, `](` would close our link and let the rest of it
    // become markdown of the author's choosing.
    expect(body).not.toContain('https://evil.example)');
    expect(body).toContain(
      String.raw`[\]\(https://evil.example\) \[click me ↗︎](https://app.test/agent/a/tpc_1)`,
    );
  });

  it('shows dashes for what is not linked yet', () => {
    const body = buildTrackingComment({ marker, updatedAt: new Date('2026-01-05T00:07:00Z') });
    expect(body).toContain('| — | — | — | — | Jan 5, 2026 12:07am |');
  });

  it('formats UTC the way the Updated column expects', () => {
    expect(formatUtc(new Date('2026-09-20T00:00:00Z'))).toBe('Sep 20, 2026 12:00am');
    expect(formatUtc(new Date('2026-09-20T12:30:00Z'))).toBe('Sep 20, 2026 12:30pm');
    expect(formatUtc(new Date('2026-09-20T23:59:00Z'))).toBe('Sep 20, 2026 11:59pm');
  });
});
