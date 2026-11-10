// oxlint-disable-next-line stylex-migration/no-emotion-styles -- Form.Group renders its body without a slot
import { createStaticStyles } from '@lobehub/ui';

/** Shared by the section skeleton and the tab skeletons that draw their own `Form.Group`. */
export const sectionGroupStyles = createStaticStyles(({ css }) => ({
  group: css`
    /* A loaded settings form renders its fields flush in the group body (each field
       pads itself), while a bare Form.Group pads the body by 16px on both ends. */
    > :last-child {
      padding-block: 0;
    }
  `,
}));
