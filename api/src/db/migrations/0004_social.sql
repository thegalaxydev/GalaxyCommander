CREATE TABLE IF NOT EXISTS "follows" (
	"follower_id" text NOT NULL,
	"following_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deck_likes" (
	"owner_user_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deck_likes_owner_user_id_deck_id_user_id_pk" PRIMARY KEY("owner_user_id","deck_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deck_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deck_views" (
	"owner_user_id" text NOT NULL,
	"deck_id" text NOT NULL,
	"viewer_key" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deck_views_owner_user_id_deck_id_viewer_key_day_pk" PRIMARY KEY("owner_user_id","deck_id","viewer_key","day")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_user_id_fk" FOREIGN KEY ("follower_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_user_id_fk" FOREIGN KEY ("following_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_likes" ADD CONSTRAINT "deck_likes_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_likes" ADD CONSTRAINT "deck_likes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "deck_views" ADD CONSTRAINT "deck_views_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_following_idx" ON "follows" ("following_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_follower_idx" ON "follows" ("follower_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deck_likes_deck_idx" ON "deck_likes" ("owner_user_id","deck_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deck_comments_deck_idx" ON "deck_comments" ("owner_user_id","deck_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deck_comments_author_idx" ON "deck_comments" ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deck_views_deck_idx" ON "deck_views" ("owner_user_id","deck_id");
