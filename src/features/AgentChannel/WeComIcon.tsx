import { WeCom } from '@lobehub/ui/icons';
import type { SVGProps } from 'react';
import { memo } from 'react';

/*
 * `@lobehub/ui/icons` WeCom (checked 6.16.0) fills its `Color` variant with the brand blue only, so
 * the four petals at the bottom right render blue instead of WeCom's green / blue / orange /
 * yellow. Same TDesign `logo-wecom` path (MIT), split into the bubble and one subpath per petal,
 * filled with the colors of WeCom's own favicon (work.weixin.qq.com). Drop this file once
 * `@lobehub/ui/icons` ships a multi-color `WeCom.Color`.
 */
const BUBBLE =
  'M17.326 8.158l-.003-.007a6.6 6.6 0 0 0-1.178-1.674c-1.266-1.307-3.067-2.19-5.102-2.417a9.3 9.3 0 0 0-2.124 0h-.001c-2.061.228-3.882 1.107-5.14 2.405a6.7 6.7 0 0 0-1.194 1.682A5.7 5.7 0 0 0 2 10.657c0 1.106.332 2.218.988 3.201l.006.01c.391.594 1.092 1.39 1.637 1.83l.983.793l-.208.875l.527-.267l.708-.358l.761.225c.467.137.955.227 1.517.29h.005q.515.06 1.026.059c.355 0 .724-.02 1.095-.06a9 9 0 0 0 1.346-.258c.095.7.43 1.337.932 1.81c-.658.208-1.352.358-2.061.436c-.442.048-.883.072-1.312.072q-.627 0-1.253-.072a10.7 10.7 0 0 1-1.861-.36l-2.84 1.438s-.29.131-.44.131c-.418 0-.702-.285-.702-.704c0-.252.067-.598.128-.84l.394-1.653c-.728-.586-1.563-1.544-2.052-2.287A7.76 7.76 0 0 1 0 10.658a7.7 7.7 0 0 1 .787-3.39a8.7 8.7 0 0 1 1.551-2.19c1.61-1.665 3.878-2.73 6.359-3.006a11.3 11.3 0 0 1 2.565 0c2.47.275 4.712 1.353 6.323 3.017a8.6 8.6 0 0 1 1.539 2.192c.466.945.769 1.937.769 2.978a3.06 3.06 0 0 0-2-.005c-.001-.644-.189-1.329-.564-2.09z';
const PETAL_TOP =
  'M21.451 15.135l-.024-.024l-.024-.018l-.024-.018l-.096-.095a4.24 4.24 0 0 1-1.169-2.192q0-.038-.006-.075l-.006-.056l-.035-.144a1.3 1.3 0 0 0-.358-.61a1.386 1.386 0 0 0-1.957 0a1.4 1.4 0 0 0 0 1.963c.191.191.418.311.668.371c.024.012.06.012.084.012q.019 0 .041.006q.023.005.042.006a4.24 4.24 0 0 1 2.231 1.186c.048.048.096.095.131.143a.323.323 0 0 0 .466 0a.35.35 0 0 0 .036-.455';
const PETAL_RIGHT =
  'M20.401 19.505l-.025.025c-.119.096-.31.096-.453-.036a.326.326 0 0 1 0-.467c.047-.036.094-.083.141-.13l.002-.002a4.27 4.27 0 0 0 1.187-2.28q.005-.024.006-.043c0-.024 0-.06.012-.084a1.386 1.386 0 0 1 2.326-.67a1.4 1.4 0 0 1 0 1.964c-.167.18-.382.299-.608.359l-.143.036l-.057.005q-.035.006-.075.007a4.2 4.2 0 0 0-2.183 1.173l-.095.096q-.009.01-.018.024t-.018.024';
const PETAL_BOTTOM =
  'M16.008 18.453l.024.024l.024.018q.015.009.024.018l.096.096a4.25 4.25 0 0 1 1.169 2.19q0 .04.006.076q.005.03.006.057l.035.143c.06.228.18.443.358.611c.537.539 1.42.539 1.957 0a1.4 1.4 0 0 0 0-1.964a1.4 1.4 0 0 0-.668-.371c-.024-.012-.06-.012-.084-.012q-.018 0-.041-.006l-.042-.006a4.25 4.25 0 0 1-2.231-1.185a1.4 1.4 0 0 1-.131-.144a.323.323 0 0 0-.466 0a.325.325 0 0 0-.036.455';
const PETAL_LEFT =
  'M17.047 14.095l.024-.024a.32.32 0 0 1 .453.035a.326.326 0 0 1 0 .467c-.047.036-.094.083-.141.13l-.002.002a4.27 4.27 0 0 0-1.187 2.281l-.006.042c0 .024 0 .06-.012.084a1.386 1.386 0 0 1-2.326.67a1.4 1.4 0 0 1 0-1.963c.166-.18.381-.3.608-.36l.143-.035q.026 0 .056-.006q.037-.005.075-.006a4.2 4.2 0 0 0 2.183-1.174l.096-.095l.018-.025z';

// lobe-design-ignore LOBE-RAW-COLOR: third-party brand colors, not theme colors; @lobehub/ui/icons hard-codes brand colors the same way
const COLORS = { blue: '#0082EF', green: '#2DBC00', orange: '#FB6500', yellow: '#FFCC00' };

interface WeComColorProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

const Color = memo<WeComColorProps>(({ size = '1em', style, ...rest }) => (
  <svg
    height={size}
    style={{ flex: 'none', lineHeight: 1, ...style }}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    <title>{WeCom.title}</title>
    <path d={BUBBLE} fill={COLORS.blue} />
    <path d={PETAL_TOP} fill={COLORS.green} />
    <path d={PETAL_RIGHT} fill={COLORS.blue} />
    <path d={PETAL_BOTTOM} fill={COLORS.orange} />
    <path d={PETAL_LEFT} fill={COLORS.yellow} />
  </svg>
));

/** `@lobehub/ui/icons` WeCom with a multi-color `.Color`; mono and avatar stay upstream. */
export const WeComIcon = Object.assign(
  memo<WeComColorProps>((props) => <WeCom {...props} />),
  {
    Avatar: WeCom.Avatar,
    Color,
    colorPrimary: WeCom.colorPrimary,
    title: WeCom.title,
  },
);
