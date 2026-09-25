import { createStaticStyles, cssVar } from 'antd-style';

const styles = createStaticStyles(({ css }) => ({
  dot: css`
    display: inline-block;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    vertical-align: middle;
  `,
}));

interface PresenceDotProps {
  live: boolean;
  title?: string;
}

/**
 * A connection-state dot meant to sit on a text line: render it inside a
 * `Text` so `vertical-align: middle` centers it on that text's x-height.
 * Flex centering lines up boxes, not glyphs, and leaves the dot visibly off
 * next to lowercase text.
 */
const PresenceDot = ({ live, title }: PresenceDotProps) => (
  <span
    className={styles.dot}
    style={{ background: live ? cssVar.colorSuccess : cssVar.colorTextQuaternary }}
    title={title}
  />
);

export default PresenceDot;
