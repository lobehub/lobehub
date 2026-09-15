import { describe, expect, it } from 'vitest';

import { getPageCollaborationErrorPresentation } from './collaborationLifecycle';

describe('getPageCollaborationErrorPresentation', () => {
  it('reserves occupied copy for the explicit browser capacity error', () => {
    expect(getPageCollaborationErrorPresentation('browser_client_limit')).toEqual({
      descriptionKey: 'pageEditor.editMode.lockedDescription',
      titleKey: 'pageEditor.editMode.lockedBySomeone',
      type: 'warning',
    });
  });

  it('maps backend failures to service-unavailable copy', () => {
    expect(getPageCollaborationErrorPresentation('backend_unavailable')).toEqual({
      descriptionKey: 'pageEditor.editMode.collaboration.backendUnavailableDescription',
      titleKey: 'pageEditor.editMode.collaboration.backendUnavailableTitle',
      type: 'error',
    });
  });

  it('maps terminal provider failures to service-unavailable copy', () => {
    expect(getPageCollaborationErrorPresentation('provider_terminated')).toEqual({
      descriptionKey: 'pageEditor.editMode.collaboration.backendUnavailableDescription',
      titleKey: 'pageEditor.editMode.collaboration.backendUnavailableTitle',
      type: 'error',
    });
  });

  it.each(['unauthorized', 'snapshot_version_mismatch', 'missing_snapshot'])(
    'maps %s to generic read-only copy rather than occupied copy',
    (code) => {
      expect(getPageCollaborationErrorPresentation(code)).toEqual({
        descriptionKey: 'pageEditor.editMode.collaboration.readOnlyDescription',
        titleKey: 'pageEditor.editMode.collaboration.readOnlyTitle',
        type: 'info',
      });
    },
  );
});
