import bcrypt from 'bcryptjs';

// Test user credentials - these are used for e2e testing only
export const TEST_USER = {
  email: 'e2e-test@lobehub.com',
  fullName: 'E2E Test User',
  id: 'user_e2e_test_user_001',
  password: 'TestPassword123!',
  username: 'e2e_test_user',
};

/**
 * Create a bcrypt password hash
 * Better Auth supports bcrypt for passwords migrated from Clerk
 */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Seed test user into the database for e2e testing
 * This function connects directly to PostgreSQL and creates the necessary records
 */
export async function seedTestUser(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.log('⚠️ DATABASE_URL not set, skipping test user seeding');
    return;
  }

  // Dynamic import pg to avoid bundling issues
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('🔌 Connected to database for test user seeding');

    const now = new Date().toISOString();
    // Use fixed account ID to avoid conflicts when multiple workers run concurrently
    const accountId = 'e2e_test_account_001';

    // Use upsert to handle concurrent worker execution
    // Insert user or do nothing if already exists (handles all unique constraints)
    const passwordHash = await hashPassword(TEST_USER.password);

    // Use ON CONFLICT DO NOTHING to handle all unique constraint conflicts
    // This is safe because we're using fixed test user credentials
    await client.query(
      `INSERT INTO users (id, email, normalized_email, username, full_name, email_verified, created_at, updated_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
       ON CONFLICT DO NOTHING`,
      [
        TEST_USER.id,
        TEST_USER.email,
        TEST_USER.email.toLowerCase(),
        TEST_USER.username,
        TEST_USER.fullName,
        true, // email_verified
        now,
      ],
    );

    // Create account record with password (for credential login)
    await client.query(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT DO NOTHING`,
      [
        accountId,
        TEST_USER.id,
        TEST_USER.email, // account_id is email for credential provider
        'credential', // provider_id
        passwordHash,
        now,
      ],
    );

    console.log('✅ Test user seeded successfully');
    console.log(`   Email: ${TEST_USER.email}`);
    console.log(`   Password: ${TEST_USER.password}`);
  } catch (error) {
    console.error('❌ Failed to seed test user:', error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Clean up test user data after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    // Delete sessions first (foreign key)
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [TEST_USER.id]);

    // Delete accounts (foreign key)
    await client.query('DELETE FROM accounts WHERE user_id = $1', [TEST_USER.id]);

    // Delete user
    await client.query('DELETE FROM users WHERE id = $1', [TEST_USER.id]);

    console.log('🧹 Test user cleaned up');
  } catch (error) {
    console.error('❌ Failed to cleanup test user:', error);
  } finally {
    await client.end();
  }
}
