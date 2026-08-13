import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { resolveChiefAgentArtwork } from '@/features/ChiefAgent/artwork';
import { useAgentStore } from '@/store/agent';
import { useAgentMeta } from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  // Anchored below the greeting row rather than above the rail, so the agent
  // stands the same distance into the first card however the greeting wraps.
  image: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -64px;
    inset-inline-end: 12px;

    width: 152px;
    height: 152px;

    object-fit: contain;
  `,
  root: css`
    position: relative;
    height: 100%;
  `,
}));

const HomePortrait = memo(() => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentMeta(inboxAgentId ?? '');
  const artwork = resolveChiefAgentArtwork(inboxMeta.avatar || DEFAULT_INBOX_AVATAR);

  return (
    <div className={styles.root}>
      <img aria-hidden alt="" className={styles.image} src={artwork.hero} />
    </div>
  );
});

export default HomePortrait;
