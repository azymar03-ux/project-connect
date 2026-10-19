ALTER TABLE "GithubLink" ADD COLUMN "revision" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);
