import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { resolveChiefAgentArtwork } from '@/features/ChiefAgent/artwork';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from './AgentSelect/useResolvedHomeAgentId';
import { HOME_PORTRAIT_INSET } from './portraitFraming';

const styles = createStaticStyles(({ css }) => ({
  /**
   * The speech layout owns image dimensions and overlap. Both sizes reveal
   * the same fraction used by the artwork studio preview, with the lower
   * body passing behind the supporting card.
   */
  image: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: var(--home-portrait-overlap);
    inset-inline-end: ${HOME_PORTRAIT_INSET}px;

    width: var(--home-portrait-width);
    height: var(--home-portrait-height);

    object-fit: contain;
    object-position: bottom;
  `,
  root: css`
    position: relative;
    height: 100%;
  `,
}));

const HomePortrait = memo(() => {
  // The portrait depicts whoever home is addressing, so it follows the same
  // selection the composer sends to — not the Inbox Agent it defaults to.
  const { agentId } = useResolvedHomeAgentId();
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  // A freshly picked agent may not be in the store yet; without this the
  // portrait would silently stay on the previous one's artwork.
  useFetchAgentConfig(true, agentId ?? '');

  const meta = useAgentStore(agentSelectors.getAgentMetaById(agentId ?? ''));
  // An agent that has been through the artwork studio shows its own character;
  // the built-in catalog covers everyone else.
  const fullBodyArtwork = useAgentStore(agentSelectors.getAgentFullBodyArtworkById(agentId ?? ''));
  const artwork = resolveChiefAgentArtwork(meta.avatar || DEFAULT_INBOX_AVATAR);
  const hero = fullBodyArtwork || artwork.hero;

  return (
    <div className={styles.root}>
      <img aria-hidden alt="" className={styles.image} key={hero} src={hero} />
    </div>
  );
});

export default HomePortrait;
