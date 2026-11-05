'use client';

import { findObject } from '@lobechat/builtin-tool-mini-game';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Armchair, Eye, Footprints, type LucideIcon, MapPin } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { miniGameSelectors, useMiniGameStore } from '@/store/miniGame';

const POSE_ICONS: Record<string, LucideIcon> = {
  idle: MapPin,
  sitting: Armchair,
  walking: Footprints,
  watching: Eye,
};

/** The character's current state in words, so it is visible without reading the scene. */
const StatusBar = memo(() => {
  const { t } = useTranslation('chat');
  const [scene, character, pendingTargetId, nearby] = useMiniGameStore((s) => [
    s.scene,
    s.character,
    s.pendingTargetId,
    miniGameSelectors.nearbyObject(s),
  ]);

  const nameOf = (id?: string) => {
    const object = id ? findObject(scene, id) : undefined;
    return object ? t(`miniGame.objects.${object.kind}`) : undefined;
  };

  let status: string;
  switch (character.pose) {
    case 'walking': {
      const target = nameOf(pendingTargetId);
      status = target ? t('miniGame.status.walkingTo', { target }) : t('miniGame.status.walking');
      break;
    }
    case 'sitting': {
      status = t('miniGame.status.sitting', { target: nameOf(character.activity?.targetId) });
      break;
    }
    case 'watching': {
      status = t('miniGame.status.watching', { target: nameOf(character.activity?.targetId) });
      break;
    }
    default: {
      const target = nameOf(nearby?.id);
      status = target ? t('miniGame.status.idleNear', { target }) : t('miniGame.status.idle');
    }
  }

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
      <Flexbox horizontal align={'center'} data-testid="mini-game-status" gap={6}>
        <Icon icon={POSE_ICONS[character.pose] ?? MapPin} size={16} />
        <Text weight={500}>{status}</Text>
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('miniGame.position', { x: character.position.x, y: character.position.y })}
      </Text>
    </Flexbox>
  );
});

StatusBar.displayName = 'MiniGameStatusBar';

export default StatusBar;
