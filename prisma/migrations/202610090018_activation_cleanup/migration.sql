BEGIN;
DELETE FROM "OAuthAccount" WHERE "userId" IN (SELECT id FROM "User" WHERE "activationRequired");
UPDATE "User" SET bio='', "portfolioUrl"='',education='',city='',skills=ARRAY[]::text[],interests=ARRAY[]::text[],role='Developer' WHERE "activationRequired";
COMMIT;
