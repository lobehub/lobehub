/**
 * Reset onboarding state for a user (by email) so they re-enter the
 * shared-prefix onboarding flow from scratch.
 *
 * Usage: tsx scripts/resetOnboarding/index.ts <email>
 *
 * Clears:
 *   users.onboarding         (currentStep, finishedAt, version)
 *   users.agent_onboarding   (agent flow state)
 *   users.full_name          (so FullNameStep is unfilled again)
 *   users.interests          (so InterestsStep is unfilled again)
 *   user_settings.general.responseLanguage  (so commonStepsCompleted=false)
 *   user_settings.general.telemetry         (so privacy switch defaults again)
 */
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { eq, sql } from 'drizzle-orm';

const env = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${env}.local` }));

const main = async () => {
  const email = process.argv[2];

  if (!email) {
    console.error('❌ Missing email argument.');
    console.error('   Usage: tsx scripts/resetOnboarding/index.ts <email>');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Configure .env first.');
    process.exit(1);
  }

  const { serverDB } = await import('../../packages/database/src/server');
  const { users, userSettings } = await import('../../packages/database/src/schemas/user');

  const matched = await serverDB
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      interests: users.interests,
      onboarding: users.onboarding,
      agentOnboarding: users.agentOnboarding,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const target = matched[0];

  if (!target) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }

  console.log(`🔍 Found user: id=${target.id}, email=${target.email}`);
  console.log('   Before:');
  console.log('     onboarding       =', target.onboarding ?? null);
  console.log('     agent_onboarding =', target.agentOnboarding ?? null);
  console.log('     full_name        =', target.fullName ?? null);
  console.log('     interests        =', target.interests ?? null);

  const settingsBefore = await serverDB
    .select({ general: userSettings.general })
    .from(userSettings)
    .where(eq(userSettings.id, target.id))
    .limit(1);
  const generalBefore = (settingsBefore[0]?.general ?? {}) as Record<string, unknown>;

  console.log(
    '     responseLanguage =',
    generalBefore.responseLanguage ?? null,
    '   telemetry =',
    generalBefore.telemetry ?? null,
  );

  await serverDB.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        onboarding: null,
        agentOnboarding: null,
        fullName: null,
        interests: null,
      })
      .where(eq(users.id, target.id));

    await tx
      .update(userSettings)
      .set({
        general: sql`(${userSettings.general}::jsonb) - 'responseLanguage' - 'telemetry'`,
      })
      .where(eq(userSettings.id, target.id));
  });

  const settingsAfter = await serverDB
    .select({ general: userSettings.general })
    .from(userSettings)
    .where(eq(userSettings.id, target.id))
    .limit(1);
  const generalAfter = (settingsAfter[0]?.general ?? {}) as Record<string, unknown>;

  console.log('✅ Reset complete.');
  console.log('   After:');
  console.log('     responseLanguage =', generalAfter.responseLanguage ?? null);
  console.log('     telemetry        =', generalAfter.telemetry ?? null);
  console.log('   Visit /onboarding to start over.');

  process.exit(0);
};

main().catch((err) => {
  console.error('❌ Reset failed:', err);
  process.exit(1);
});
