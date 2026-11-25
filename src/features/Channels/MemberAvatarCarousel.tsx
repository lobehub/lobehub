import type { ChannelPublicMember } from '@lobechat/types';
import * as stylex from '@stylexjs/stylex';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberAvatar } from './MemberAvatar';
import { carouselMembers, carouselWindow, MEMBER_CAROUSEL_SIZE } from './memberCarousel';
import { memberName } from './memberName';
import { styles } from './styles';

const STEP_MS = 2500;
const OVERLAP = 8;

/**
 * Who is in a Channel, as an overlapping stack of up to three avatars. With more members it
 * rotates one at a time: the leftmost fades out, the rest slide over, the next enters on the
 * right. Hovering or focusing it holds still so a name can be read; reduced motion never rotates.
 */
export function MemberAvatarCarousel({
  members,
  size = 32,
}: {
  members: ChannelPublicMember[];
  size?: number;
}) {
  const { t, i18n } = useTranslation('channel');
  const ordered = useMemo(() => carouselMembers(members), [members]);
  const [step, setStep] = useState(0);
  const [held, setHeld] = useState(false);
  const reducedMotion = useReducedMotion();
  const rotates = ordered.length > MEMBER_CAROUSEL_SIZE && !reducedMotion;

  useEffect(() => {
    if (!rotates || held) return;
    const timer = setInterval(() => setStep((current) => current + 1), STEP_MS);
    return () => clearInterval(timer);
  }, [rotates, held]);

  const label = useMemo(
    () =>
      new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
        ordered.map((member) => memberName(member, t('deletedMember'))),
      ),
    [i18n.language, ordered, t],
  );

  return (
    <div
      aria-label={label}
      role="img"
      onBlur={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      {...stylex.props(
        styles.avatarStack,
        styles.avatarStackSize(size + (MEMBER_CAROUSEL_SIZE - 1) * (size - OVERLAP), size),
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {carouselWindow(ordered, rotates ? step : 0).map(({ key, member }, slot) => (
          <m.span
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            initial={{ opacity: 0, scale: 0.8 }}
            key={key}
            layout="position"
            transition={{ duration: 0.24, ease: 'easeOut' }}
            {...stylex.props(
              styles.avatarStackItem,
              // The leftmost avatar sits on top, so the one entering slides in underneath.
              styles.avatarStackSlot(slot === 0 ? 0 : -OVERLAP, MEMBER_CAROUSEL_SIZE - slot),
            )}
          >
            <MemberAvatar member={member} size={size} />
          </m.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
