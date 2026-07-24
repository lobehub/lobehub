import type { BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../lobehub/helpers';
import agentBrowser from './references/agent-browser.md';
import auth from './references/auth.md';
import computerUse from './references/computer-use.md';
import evidence from './references/evidence.md';
import planFormat from './references/plan-format.md';
import recording from './references/recording.md';
import content from './SKILL.md';
import cli from './surfaces/cli.md';
import electron from './surfaces/electron.md';
import native from './surfaces/native.md';
import web from './surfaces/web.md';

export const AcceptanceIdentifier = 'acceptance';

/**
 * Portable builder-side acceptance skill. Unlike the repo-local `agent-testing`
 * skill (macOS scripts + local report dirs + LobeHub-specific probes), this one
 * depends only on the `lh` CLI and `agent-browser`, so any external builder
 * (Claude Code / Codex) can run it from a task's working directory: discover the
 * plan → pick a surface → capture evidence per criterion → `lh acceptance run
 * result submit` → self-check coverage.
 *
 * The references carry the full operating manual (agent-browser CLI, web vs
 * Electron decision + setup, auth recipes, capture recipes), with all
 * LobeHub-only coupling generalized away.
 *
 * Resource keys keep the `.md` extension so a disk pull
 * (`.agents/skills/acceptance/references/*.md`) maps 1:1 to real files and the
 * in-SKILL relative links resolve.
 */
export const AcceptanceSkill: BuiltinSkill = {
  avatar: '✅',
  content,
  description:
    'Self-evidence for task delivery acceptance — discover the verify plan, pick the right surface (CLI / web / desktop), drive it with agent-browser, get past auth, capture portable evidence per criterion, and submit each with `lh acceptance run result submit` so the delivery is judged on real proof.',
  identifier: AcceptanceIdentifier,
  name: 'acceptance',
  resources: toResourceMeta({
    'references/agent-browser.md': agentBrowser,
    'references/auth.md': auth,
    'references/computer-use.md': computerUse,
    'references/evidence.md': evidence,
    'references/plan-format.md': planFormat,
    'references/recording.md': recording,
    'surfaces/cli.md': cli,
    'surfaces/electron.md': electron,
    'surfaces/native.md': native,
    'surfaces/web.md': web,
  }),
  source: 'builtin',
};
