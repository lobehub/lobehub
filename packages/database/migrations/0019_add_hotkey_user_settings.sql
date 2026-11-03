-- Add hotkey column to user_settings table
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "hotkey" jsonb;--> statement-breakpoint
