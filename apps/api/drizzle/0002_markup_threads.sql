DELETE FROM "comments";--> statement-breakpoint
DELETE FROM "threads";--> statement-breakpoint
DELETE FROM "thread_number_seq";--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "markup" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "anchor";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "tags";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN "carried_from";