// oxlint-disable-next-line stylex-migration/no-emotion-styles -- @xyflow/react edge, label and controls DOM takes no className
import { createStaticStyles, cssVar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import { MUTED_EDGE_OPACITY, MUTED_EDGE_OPACITY_DARK } from './mainline';

const styles = stylex.create({
  canvas: {
    position: 'relative',
    width: '100%',
    height: '560px',
  },
  fullscreen: {
    height: '100%',
  },
});

const fallback = createStaticStyles(({ css }) => ({
  canvas: css`
    .react-flow__attribution {
      display: none;
    }

    .react-flow__edge-path {
      stroke: ${cssVar.colorBorder};
      stroke-width: 1.25;
    }

    /* Provenance links can cross cards, but must not intercept their actions. */
    .react-flow__edge,
    .react-flow__edge * {
      pointer-events: none;
    }

    .react-flow__edge.goal-dep .react-flow__edge-path {
      stroke-dasharray: 5 4;
    }

    /* A chapter map's detours: the line into a stray card reads in the same
       orange dash as the card's own frame. */
    .react-flow__edge.goal-detour .react-flow__edge-path {
      stroke: ${cssVar.colorWarning};
      stroke-dasharray: 6 4;
      stroke-width: 1.75;
    }

    .react-flow__edge.goal-muted:not(.goal-hot) {
      opacity: ${MUTED_EDGE_OPACITY};
    }

    .react-flow__edge.goal-hot .react-flow__edge-path {
      stroke: ${cssVar.colorPrimary};
      stroke-width: 1.75;
    }

    /* Off-mainline lines keep their step-back on the light canvas. On the dark
       one that same border token at a third opacity turns into background, so
       the line is lifted just enough to read; the mainline's lines stay at full
       strength either way, so the hierarchy is not flattened. These
       dark-theme overrides carry higher specificity, so they sit last to keep
       the cascade ascending. */
    html[data-theme='dark'] & .react-flow__edge.goal-muted:not(.goal-hot) {
      opacity: ${MUTED_EDGE_OPACITY_DARK};
    }

    html[data-theme='dark'] & .react-flow__edge.goal-muted:not(.goal-hot) .react-flow__edge-path {
      stroke: ${cssVar.colorTextQuaternary};
    }

    /* The mainline is carried by its cards' ring; its lines stay ordinary, at
       full strength while the rest steps back. On the dark canvas they take the
       same lifted token as the muted lines so they never read fainter. */
    html[data-theme='dark']
      &
      .react-flow__edge.goal-mainline:not(.goal-hot)
      .react-flow__edge-path {
      stroke: ${cssVar.colorTextQuaternary};
    }

    .react-flow__edge-textbg {
      fill: ${cssVar.colorBgLayout};
    }

    .react-flow__edge-text {
      font-size: 10px;
      fill: ${cssVar.colorTextTertiary};
    }

    .react-flow__controls-button {
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgContainer};
      fill: ${cssVar.colorTextSecondary};

      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    }
  `,
}));

export const canvasRootProps = (fullscreen: boolean, inlineHeight: number) =>
  sx(
    [styles.canvas, fullscreen && styles.fullscreen],
    fallback.canvas,
    fullscreen ? undefined : { height: inlineHeight },
  );
