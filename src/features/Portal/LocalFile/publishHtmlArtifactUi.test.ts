import { describe, expect, it } from 'vitest';

import {
  getPublishHtmlArtifactSlots,
  hasWorkspaceHtmlPackingDetails,
  shouldOfferWorkspaceHtmlPublish,
} from './publishHtmlArtifactUi';

describe('getPublishHtmlArtifactSlots', () => {
  it('pins the public URL on a live bar instead of the receding preview chrome', () => {
    expect(
      getPublishHtmlArtifactSlots({
        available: true,
        enabled: true,
        isHtml: true,
        publicUrl: 'https://demo.lobe.page',
      }),
    ).toEqual({
      showLiveBar: true,
      showOverlayTrigger: false,
    });
  });

  it('hides both slots when the feature is off or the file is not HTML', () => {
    expect(
      getPublishHtmlArtifactSlots({
        available: true,
        enabled: false,
        isHtml: true,
        publicUrl: 'https://demo.lobe.page',
      }),
    ).toEqual({
      showLiveBar: false,
      showOverlayTrigger: false,
    });

    expect(
      getPublishHtmlArtifactSlots({
        available: true,
        enabled: true,
        isHtml: false,
      }),
    ).toEqual({
      showLiveBar: false,
      showOverlayTrigger: false,
    });
  });

  it('keeps the first publish action on the preview chrome when nothing is live', () => {
    expect(
      getPublishHtmlArtifactSlots({
        available: true,
        enabled: true,
        isHtml: true,
      }),
    ).toEqual({
      showLiveBar: false,
      showOverlayTrigger: true,
    });
  });
});

describe('shouldOfferWorkspaceHtmlPublish', () => {
  it('offers publish only for HTML files when the feature is on', () => {
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: true,
        enabled: true,
        isFolder: false,
        path: '/repo/index.html',
      }),
    ).toBe(true);
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: true,
        enabled: true,
        isFolder: false,
        path: '/repo/page.htm',
      }),
    ).toBe(true);
  });

  it('hides publish for folders, non-HTML files, and a disabled feature', () => {
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: true,
        enabled: true,
        isFolder: true,
        path: '/repo/site.html',
      }),
    ).toBe(false);
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: true,
        enabled: true,
        isFolder: false,
        path: '/repo/readme.md',
      }),
    ).toBe(false);
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: true,
        enabled: false,
        isFolder: false,
        path: '/repo/index.html',
      }),
    ).toBe(false);
    expect(
      shouldOfferWorkspaceHtmlPublish({
        available: false,
        enabled: true,
        isFolder: false,
        path: '/repo/index.html',
      }),
    ).toBe(false);
  });
});

describe('hasWorkspaceHtmlPackingDetails', () => {
  it('hides the packing list when the page has no extra files', () => {
    expect(
      hasWorkspaceHtmlPackingDetails({
        inlinedPaths: [],
        missing: [],
        oversized: [],
        remotes: [],
        uploadedPaths: [],
      }),
    ).toBe(false);
  });

  it('keeps packing details available when any extra file exists', () => {
    expect(
      hasWorkspaceHtmlPackingDetails({
        inlinedPaths: ['style.css'],
        missing: [],
        oversized: [],
        remotes: [],
        uploadedPaths: [],
      }),
    ).toBe(true);
  });
});
