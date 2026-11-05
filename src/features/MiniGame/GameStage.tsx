'use client';

import {
  findObject,
  type GameActionRequest,
  type GameObject,
  type GameScene,
} from '@lobechat/builtin-tool-mini-game';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { miniGameActions, STEP_DURATION_MS, useMiniGameStore } from '@/store/miniGame';
import { sx } from '@/styles/sx';

import Character from './Character';
import { ART, TILE } from './palette';
import SceneObject, { getObjectBox } from './SceneObject';
import { useAssistantSpeech } from './useAssistantSpeech';

const styles = stylex.create({
  bubble: {
    backgroundColor: cssVar.colorBgElevated,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 10,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: cssVar.boxShadowTertiary,
    color: cssVar.colorText,
    fontSize: 12,
    lineHeight: 1.5,
    maxWidth: 200,
    paddingBlock: 6,
    paddingInline: 10,
    pointerEvents: 'none',
    position: 'absolute',
    transitionProperty: 'left, top',
    transitionTimingFunction: 'linear',
    width: 'max-content',
  },
  ground: {
    cursor: 'pointer',
  },
  stage: {
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  svg: {
    display: 'block',
    height: 'auto',
    width: '100%',
  },
});

/** What clicking an object asks the character to do. */
export const defaultRequestFor = (object: GameObject): GameActionRequest => {
  if (object.actions.includes('sitOn')) return { action: 'sitOn', targetId: object.id };
  if (object.actions.includes('watch')) return { action: 'watch', targetId: object.id };
  return { action: 'moveTo', targetId: object.id };
};

/** Center of the character's feet in viewBox pixels; seated characters sit on the bench. */
const toPixel = (scene: GameScene, position: { x: number; y: number }, seatOf?: string) => {
  const seat = seatOf ? findObject(scene, seatOf) : undefined;
  if (seat) {
    const box = getObjectBox(seat);
    return { x: box.x + box.w / 2, y: box.y + 22 };
  }
  return { x: position.x * TILE + TILE / 2, y: position.y * TILE + TILE - 4 };
};

const Ground = memo<{ height: number; width: number }>(({ height, width }) => {
  const tiles = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((x + y) % 2 === 0)
        tiles.push(
          <rect
            fill={ART.grassDark}
            height={TILE}
            key={`${x},${y}`}
            width={TILE}
            x={x * TILE}
            y={y * TILE}
          />,
        );
  return (
    <>
      <rect fill={ART.grass} height={height * TILE} width={width * TILE} x={0} y={0} />
      {tiles}
    </>
  );
});

Ground.displayName = 'MiniGameGround';

const GameStage = memo(() => {
  const { t } = useTranslation('chat');
  const [scene, character, pendingTargetId] = useMiniGameStore((s) => [
    s.scene,
    s.character,
    s.pendingTargetId,
  ]);
  const speech = useAssistantSpeech();

  const seatOf = character.pose === 'sitting' ? character.activity?.targetId : undefined;
  const pixel = toPixel(scene, character.position, seatOf);
  const width = scene.size.width * TILE;
  const height = scene.size.height * TILE;

  const handleSelect = useCallback((object: GameObject) => {
    void miniGameActions.perform(defaultRequestFor(object));
  }, []);

  const handleGroundClick = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * scene.size.width);
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * scene.size.height);
      void miniGameActions.perform({ action: 'moveTo', point: { x, y } });
    },
    [scene.size.height, scene.size.width],
  );

  // Objects lower on screen are drawn later so they overlap the ones behind.
  const objects = [...scene.objects].sort(
    (a, b) => getObjectBox(a).y + getObjectBox(a).h - (getObjectBox(b).y + getObjectBox(b).h),
  );
  const characterIndex = objects.findIndex(
    (object) => getObjectBox(object).y + getObjectBox(object).h > pixel.y + 4,
  );
  const behind = characterIndex === -1 ? objects : objects.slice(0, characterIndex);
  const inFront = characterIndex === -1 ? [] : objects.slice(characterIndex);

  const renderObject = (object: GameObject) => (
    <SceneObject
      highlighted={object.id === pendingTargetId}
      key={object.id}
      label={t(`miniGame.objects.${object.kind}`)}
      object={object}
      onSelect={handleSelect}
    />
  );

  return (
    <div {...stylex.props(styles.stage)} data-testid="mini-game-stage">
      <svg
        aria-label={t('miniGame.sceneName')}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        {...stylex.props(styles.svg)}
      >
        <g {...stylex.props(styles.ground)} onClick={handleGroundClick}>
          <Ground height={scene.size.height} width={scene.size.width} />
        </g>
        {behind.map(renderObject)}
        <Character facing={character.facing} pixel={pixel} pose={character.pose} />
        {inFront.map(renderObject)}
      </svg>
      {speech && (
        <div
          data-testid="mini-game-speech"
          {...sx([styles.bubble], undefined, {
            left: `${(pixel.x / width) * 100}%`,
            top: `${((pixel.y - 44) / height) * 100}%`,
            transform: 'translate(-50%, -100%)',
            transitionDuration: `${STEP_DURATION_MS}ms`,
          })}
        >
          {speech}
        </div>
      )}
    </div>
  );
});

GameStage.displayName = 'MiniGameStage';

export default GameStage;
