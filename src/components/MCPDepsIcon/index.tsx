'use client';

import {
  SiApachemaven,
  SiBlender,
  SiBun,
  SiDeno,
  SiDocker,
  SiGit,
  SiGo,
  SiHelm,
  SiKubernetes,
  SiNodedotjs,
  SiNpm,
  SiPipx,
  SiPnpm,
  SiPython,
  SiRust,
  SiYarn,
} from '@icons-pack/react-simple-icons';
import { Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import Java from './Java';
import PowerShell from './PowerShell';
import Terminal from './Terminal';
import UV from './UV';

const icons: any = {
  blender: SiBlender,
  bun: SiBun,
  bunx: SiBun,
  deno: SiDeno,
  docker: SiDocker,
  git: SiGit,
  go: SiGo,
  helm: SiHelm,
  java: Java,
  kubectl: SiKubernetes,
  make: Terminal,
  manual: Terminal,
  maven: SiApachemaven,
  nodejs: SiNodedotjs,
  npm: SiNpm,
  npx: SiNpm,
  odbc: Terminal,
  pandoc: Terminal,
  pipx: SiPipx,
  pnpm: SiPnpm,
  pnpx: SiPnpm,
  powershell: PowerShell,
  python: SiPython,
  rust: SiRust,
  sh: Terminal,
  uv: UV,
  uvx: UV,
  yarn: SiYarn,
};

const InstallationIcon = memo<{ size?: number; type: string }>(({ type, size = 20 }) => {
  const iconType = type.split(' ')[0];
  if (iconType === 'none') return;
  return (
    <Tooltip title={iconType}>
      <Icon fill={cssVar.colorTextDescription} icon={icons?.[iconType] || Terminal} size={size} />
    </Tooltip>
  );
});

export default InstallationIcon;
