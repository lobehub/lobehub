import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { resolveChiefAgentArtwork } from '@/features/ChiefAgent/artwork';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from './AgentSelect/useResolvedHomeAgentId';

const styles = createStaticStyles(({ css }) => ({
  // Anchored below the greeting row rather than above the rail, so the agent
  // stands the same distance into the first card however the greeting wraps.
  /**
   * The built-in catalog is framed as a bust — the character already fills the
   * top of its own file — so it keeps the original small, shallow placement.
   */
  builtinImage: css`
    inset-block-end: -64px;
    width: 152px;
    height: 152px;
  `,
  /**
   * A generated character is head-to-toe, so it needs room to read at all and
   * has to sit deep enough that its legs pass behind the first card instead of
   * standing on top of it — while keeping the head clear of the header.
   */
  generatedImage: css`
    inset-block-end: -240px;
    width: 240px;
    height: 320px;
  `,
  image: css`
    pointer-events: none;

    position: absolute;
    inset-inline-end: 12px;

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
      <img
        aria-hidden
        alt=""
        className={cx(styles.image, fullBodyArtwork ? styles.generatedImage : styles.builtinImage)}
        key={hero}
        src={hero}
      />
    </div>
  );
});

export default HomePortrait;
