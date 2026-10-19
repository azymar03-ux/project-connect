-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMessage" DROP COLUMN "readAt";

