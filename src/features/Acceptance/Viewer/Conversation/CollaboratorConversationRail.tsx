'use client';

import { DraggablePanel, Flexbox, Icon, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { AcceptanceDrawer } from '../../AcceptanceDrawer';
import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceRailState } from '../History/useAcceptanceRailState';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import CollaboratorTopicPanel from './CollaboratorTopicPanel';

const styles = stylex.create({
  // Same footprint as the owner's collapsed ledger chip: a thumb-width strip on
  // the content's right edge.
  toggle: {
    backgroundColor: {
      ':hover': cssVar.colorFillQuaternary,
      'default': cssVar.colorBgContainer,
    },
    borderColor: {
      ':hover': cssVar.colorBorder,
      'default': cssVar.colorBorderSecondary,
    },
    borderRadius: 99,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    insetBlockStart: 16,
    insetInlineEnd: 12,
    paddingBlock: 8,
    paddingInline: 5,
    position: 'absolute',
    zIndex: 10,
  },
});

/**
 * The right rail for an edit-collaborator: the conversation bound to the
 * delivery, in the column the owner's round ledger occupies. The owner keeps
 * the ledger rail (with their own chat behind the topic chip); a collaborator
 * has no round history to browse, so their rail is the conversation alone.
 *
 * Only the standalone page mounts it: an embedded viewer already sits beside a
 * conversation, and has no column of its own for a second one.
 */
const CollaboratorConversationRail = () => {
  const { t } = useTranslation('verify');
  const { lg = true } = useResponsive();
  const isNarrowViewport = !lg;
  const params = useParams<{ checkId?: string }>();
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const focused = Boolean(params.checkId);
  const { expand, onExpandChange } = useAcceptanceRailState({ focused, isNarrowViewport });

  if (!data || data.isOwner || !data.canCollaborate || !data.collaboration) return null;

  const panel = <CollaboratorTopicPanel onCollapse={() => onExpandChange(false)} />;

  return (
    <>
      {!focused && !expand && (
        <Flexbox
          align={'center'}
          title={t('acceptance.collaboration.expand')}
          onClick={() => onExpandChange(true)}
          {...stylex.props(styles.toggle)}
        >
          <Icon icon={MessagesSquare} size={14} />
        </Flexbox>
      )}
      {isNarrowViewport ? (
        <AcceptanceDrawer
          noHeader
          containerMaxWidth={'100%'}
          open={expand}
          placement={'right'}
          styles={{ bodyContent: { height: '100%', padding: 0 } }}
          title={t('acceptance.collaboration.expand')}
          width={'min(380px, 92vw)'}
          onClose={() => onExpandChange(false)}
        >
          {panel}
        </AcceptanceDrawer>
      ) : (
        <DraggablePanel
          defaultSize={{ width: 380 }}
          expand={expand}
          minWidth={320}
          placement={'right'}
          style={{ flex: 'none', height: '100%' }}
          onExpandChange={onExpandChange}
        >
          <Flexbox style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>{panel}</Flexbox>
        </DraggablePanel>
      )}
    </>
  );
};

export default CollaboratorConversationRail;
