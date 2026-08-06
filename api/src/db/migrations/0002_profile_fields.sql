ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username_normalized" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "bio" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar_url" text;

UPDATE "user"
SET
  username_normalized = lower(username),
  display_name = COALESCE(display_username, username, name),
  avatar_url = image
WHERE username IS NOT NULL AND username_normalized IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_username_normalized_unique" ON "user" ("username_normalized");
