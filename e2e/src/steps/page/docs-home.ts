/**
 * Docs home navigation helpers shared by the page step files.
 *
 * Pages live in Docs now (`/resource`). A returning user also gets the one-time
 * "Pages and Resources are now Docs" notice, which is a modal and therefore
 * intercepts clicks on the quick actions underneath it — every page scenario
 * timed out on the create step until the notice was dismissed.
 *
 * The notice mounts only after the user preference is loaded, so it can appear
 * a few seconds *after* the Docs home itself renders. Every helper that clicks
 * inside Docs therefore re-checks for it instead of dismissing it once and
 * assuming it stays gone.
 */
import type { CustomWorld } from '../../support/world';

const NOTICE_TITLE = /Pages and Resources are now Docs|页面和资源已合并为 Docs/;
const NOTICE_CONFIRM = /^(Got it|知道了|我知道了)$/;

/** How long to wait for a late-mounting notice before deciding it is absent. */
const NOTICE_APPEAR_TIMEOUT = 4000;

/** Dismiss the merge notice when it is on screen; a no-op otherwise. */
export async function dismissDocsMergeNotice(
  world: CustomWorld,
  appearTimeout: number = NOTICE_APPEAR_TIMEOUT,
): Promise<void> {
  const title = world.page.getByText(NOTICE_TITLE).first();

  await title.waitFor({ state: 'visible', timeout: appearTimeout }).catch(() => {});
  if (!(await title.isVisible().catch(() => false))) return;

  const confirm = world.page.getByRole('button', { name: NOTICE_CONFIRM }).first();
  await confirm.click({ timeout: 5000 }).catch(() => {});
  await title.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

/** Load the Docs home with any one-time notice out of the way. */
export async function openDocsHome(world: CustomWorld): Promise<void> {
  await world.page.goto('/resource');
  await world.page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
  await dismissDocsMergeNotice(world);
}
