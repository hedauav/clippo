-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "adminReviewReason" TEXT;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "accessTokenEnc" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);
