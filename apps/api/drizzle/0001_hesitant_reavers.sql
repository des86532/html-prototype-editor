ALTER TABLE "auth_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "auth_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");