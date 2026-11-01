// GOOD fixture: outline: none that is not a focus-ring regression — must produce 0 findings.
// 1) Map regions are non-focusable SVG paths; react-simple-maps draws a browser outline on mousedown.
// 2) A trigger that replaces the ring with an equivalent :focus-visible indicator.
import { createStaticStyles, cssVar } from '@lobehub/ui';
import { Geographies, Geography } from 'react-simple-maps';

export const styles = createStaticStyles(({ css }) => ({
  map: css`
    & path {
      outline: none;
    }
  `,
  trigger: css`
    &:focus {
      outline: none;
    }

    &:focus-visible {
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
    }
  `,
}));

export const Regions = ({ geography }: { geography: string }) => (
  <Geographies geography={geography}>
    {({ geographies }) =>
      geographies.map((geo) => (
        <Geography
          geography={geo}
          key={geo.rsmKey}
          style={{
            default: { fill: cssVar.colorFillSecondary, outline: 'none' },
            hover: { fill: cssVar.colorPrimary, outline: 'none' },
            pressed: { fill: cssVar.colorPrimaryActive, outline: 'none' },
          }}
        />
      ))
    }
  </Geographies>
);
