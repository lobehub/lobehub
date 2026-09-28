import { cssVar } from 'antd-style';

/**
 * lucide-react 1.47 has no FolderDashed, and a strokeDasharray on the stock
 * FolderIcon is imperceptible at 14px. This is the lucide `folder` outline
 * redrawn with wide, rounded dashes so the unselected state actually reads.
 */
const DashedFolderIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    aria-hidden
    fill="none"
    height={size}
    stroke={cssVar.colorTextQuaternary}
    strokeDasharray="4.5 3"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    style={{ flex: 'none' }}
    viewBox="0 0 24 24"
    width={size}
  >
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);

export default DashedFolderIcon;
