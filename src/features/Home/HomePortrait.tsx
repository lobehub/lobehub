import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { resolveChiefAgentArtwork } from '@/features/ChiefAgent/artwork';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useResolvedHomeAgentId } from './AgentSelect/useResolvedHomeAgentId';

const styles = createStaticStyles(({ css }) => ({
  /**
   * One frame for every character. Generated artwork arrives cropped to the
   * subject, and the built-in catalog draws its character across the frame with
   * a few percent of margin, so sizing by height lands both at the same stature.
   * Anchored deep enough that the lower body passes behind the first card — the
   * character leans on the surface instead of standing on it. The offset is what
   * sets how much shows: 94px leaves `HOME_PORTRAIT_VISIBLE_RATIO` of the
   * character above the card (see ./portraitFraming), which clears the catalog
   * mascot's head — it is half its own height — and reaches the hem on a
   * standing figure, where 57% cut both at the collar and the waist. Change one
   * and the studio's preview frame stops matching what home shows.
   */
  image: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -94px;
    inset-inline-end: 12px;

    width: 176px;
    height: 200px;

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
