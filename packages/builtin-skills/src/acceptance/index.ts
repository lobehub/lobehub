import type { BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../lobehub/helpers';
import agentBrowser from './references/agent-browser.md';
import authWeb from './references/auth-web.md';
import computerUse from './references/computer-use.md';
import evidence from './references/evidence.md';
import planFormat from './references/plan-format.md';
import recordingCdp from './references/recording-cdp.md';
import recordingIosSimulator from './references/recording-ios-simulator.md';
import recordingNativeMacos from './references/recording-native-macos.md';
import report from './references/report.md';
import content from './SKILL.md';
import cli from './surfaces/cli.md';
import electron from './surfaces/electron.md';
import iosSimulator from './surfaces/ios-simulator.md';
import native from './surfaces/native.md';
import web from './surfaces/web.md';

export const AcceptanceIdentifier = 'acceptance';

/**
 * Portable builder-side acceptance skill. Unlike the repo-local `agent-testing`
 * skill (macOS scripts + project-specific working artifacts and probes), this one
 * keeps its acceptance contract independent of repository-local scripts, so any
 * external builder (Claude Code / Codex) can run it from a task's working
 * directory, with or without a LobeHub operation/topic: discover or author the
 * plan → pick a surface → capture evidence per criterion → publish a round →
 * self-check coverage. Surface-specific tools remain explicit: agent-browser for
 * Web/Electron, shell-level native automation for macOS, and an installed
 * Simulator HID/Accessibility CLI plus Xcode/simctl for iOS.
 *
 * The references carry the shared contracts and surface-scoped operating
 * manuals. Authentication and recording resources are split by runtime so a
 * selected surface never needs to load another platform's instructions.
 *
 * Resource keys keep the `.md` extension so a disk pull
 * (`.agents/skills/acceptance/references/*.md`) maps 1:1 to real files and the
 * in-SKILL relative links resolve.
 */
export const AcceptanceSkill: BuiltinSkill = {
  avatar: '✅',
  content,
  description:
    'Self-evidence for delivery acceptance in any repository, with or without a LobeHub operation or verify plan — discover or author checks, verify CLI, web, desktop, or iOS Simulator behavior on the correct surface, capture real evidence, and publish a standalone or subject-linked acceptance round.',
  identifier: AcceptanceIdentifier,
  name: 'acceptance',
  resources: toResourceMeta({
    'references/agent-browser.md': agentBrowser,
    'references/auth-web.md': authWeb,
    'references/computer-use.md': computerUse,
    'references/evidence.md': evidence,
    'references/plan-format.md': planFormat,
    'references/recording-cdp.md': recordingCdp,
    'references/recording-ios-simulator.md': recordingIosSimulator,
    'references/recording-native-macos.md': recordingNativeMacos,
    'references/report.md': report,
    'surfaces/cli.md': cli,
    'surfaces/electron.md': electron,
    'surfaces/ios-simulator.md': iosSimulator,
    'surfaces/native.md': native,
    'surfaces/web.md': web,
  }),
  source: 'builtin',
};
