-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CAMPAIGNER', 'CREATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('YOUTUBE', 'X', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "PayoutMode" AS ENUM ('PER_VIEW', 'HUMAN_SPLIT', 'POOL_SHARE');

-- CreateEnum
CREATE TYPE "PoolShareBasis" AS ENUM ('VIEWS', 'APPROVED_CLIPS');

-- CreateEnum
CREATE TYPE "Approver" AS ENUM ('CAMPAIGNER_ONLY', 'CAMPAIGNER_AND_ADMIN');

-- CreateEnum
CREATE TYPE "Eligibility" AS ENUM ('ANYONE_VERIFIED', 'HIGHER_RANKED');

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('UPLOAD', 'LINK', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'FUNDED', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "VerdictResult" AS ENUM ('APPROVE', 'REJECT', 'NEEDS_HUMAN');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('NONE', 'PENDING', 'UPHELD', 'OVERTURNED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'CLAIMED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "wallet" TEXT NOT NULL,
    "worldIdNullifier" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "externalId" TEXT,
    "verificationCode" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "campaignerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "story" JSONB NOT NULL,
    "contentSource" "ContentSource" NOT NULL,
    "contentUrl" TEXT,
    "platforms" JSONB NOT NULL,
    "payoutMode" "PayoutMode" NOT NULL,
    "poolShareBasis" "PoolShareBasis",
    "approver" "Approver",
    "poolSize" DOUBLE PRECISION NOT NULL,
    "ratePer1k" DOUBLE PRECISION,
    "viewTarget" INTEGER,
    "eligibility" "Eligibility" NOT NULL DEFAULT 'ANYONE_VERIFIED',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "onchainId" TEXT,
    "fundTxHash" TEXT,
    "rejectReason" TEXT,
    "highValue" BOOLEAN NOT NULL DEFAULT false,
    "grossFunded" DOUBLE PRECISION,
    "campaignerFee" DOUBLE PRECISION,
    "campaignerFeeBps" INTEGER,
    "creatorFeeBps" INTEGER,
    "approvalAttestation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "transcript" TEXT,
    "transcriptHash" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clipStatus" TEXT NOT NULL DEFAULT 'LIVE',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verdict" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "result" "VerdictResult" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL DEFAULT 'AI',
    "deciderId" TEXT,
    "appealStatus" "AppealStatus" NOT NULL DEFAULT 'NONE',
    "appealNote" TEXT,
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewSnapshot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "cumulativeViews" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "claimTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "releaseAt" TIMESTAMP(3),
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainCursor" (
    "key" TEXT NOT NULL,
    "lastBlock" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UsedProof" (
    "proofHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsedProof_pkey" PRIMARY KEY ("proofHash")
);

-- CreateTable
CREATE TABLE "HumanAttestation" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "splitHash" TEXT,
    "attestation" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitProposal" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "splitHash" TEXT NOT NULL,
    "splits" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "campaignerApprovedAt" TIMESTAMP(3),
    "campaignerAttestation" TEXT,
    "adminApprovedAt" TIMESTAMP(3),
    "adminAttestation" TEXT,
    "adminId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudFlag" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "FraudFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "niches" JSONB NOT NULL,
    "rateCard" JSONB NOT NULL,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HireBrief" (
    "id" TEXT NOT NULL,
    "campaignerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "story" JSONB NOT NULL,
    "deliverables" JSONB NOT NULL,
    "platforms" JSONB NOT NULL,
    "deadline" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HireBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistItem" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hire" (
    "id" TEXT NOT NULL,
    "campaignerId" TEXT NOT NULL,
    "briefId" TEXT,
    "title" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HireCreator" (
    "id" TEXT NOT NULL,
    "hireId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rateLabel" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HireCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "campaignId" TEXT,
    "kind" TEXT NOT NULL,
    "filename" TEXT,
    "storageKey" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "linkUrl" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "requestedById" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "outputAssetId" TEXT,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealTerms" (
    "campaignId" TEXT NOT NULL,
    "minRate" DOUBLE PRECISION NOT NULL,
    "maxRate" DOUBLE PRECISION NOT NULL,
    "autoAcceptUpTo" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealTerms_pkey" PRIMARY KEY ("campaignId")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "creatorMinRate" DOUBLE PRECISION,
    "offers" JSONB NOT NULL,
    "creatorAccepted" BOOLEAN NOT NULL DEFAULT false,
    "campaignerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "campaignerId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'CAMPAIGNER',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "escalatedBy" TEXT,
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorStatus" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT,
    "metrics" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "id" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCredit" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "activity" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferrerState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,
    "credited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCreditAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferrerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnchainProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "payloadHash" TEXT,
    "syncedAt" TIMESTAMP(3),
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnchainProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "User_worldIdNullifier_key" ON "User"("worldIdNullifier");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_platform_handle_key" ON "Channel"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_campaignId_videoId_key" ON "Submission"("campaignId", "videoId");

-- CreateIndex
CREATE UNIQUE INDEX "Verdict_submissionId_key" ON "Verdict"("submissionId");

-- CreateIndex
CREATE INDEX "ViewSnapshot_campaignId_day_idx" ON "ViewSnapshot"("campaignId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ViewSnapshot_submissionId_day_key" ON "ViewSnapshot"("submissionId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_logIndex_key" ON "ChainEvent"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "HumanAttestation_campaignId_kind_idx" ON "HumanAttestation"("campaignId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "HumanAttestation_attestation_key" ON "HumanAttestation"("attestation");

-- CreateIndex
CREATE INDEX "SplitProposal_campaignId_status_idx" ON "SplitProposal"("campaignId", "status");

-- CreateIndex
CREATE INDEX "FraudFlag_status_kind_idx" ON "FraudFlag"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "FraudFlag_submissionId_kind_day_key" ON "FraudFlag"("submissionId", "kind", "day");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE INDEX "HireBrief_campaignerId_idx" ON "HireBrief"("campaignerId");

-- CreateIndex
CREATE UNIQUE INDEX "Shortlist_shareToken_key" ON "Shortlist"("shareToken");

-- CreateIndex
CREATE INDEX "Shortlist_ownerId_idx" ON "Shortlist"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistItem_shortlistId_creatorId_key" ON "ShortlistItem"("shortlistId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Hire_shareToken_key" ON "Hire"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Hire_campaignId_key" ON "Hire"("campaignId");

-- CreateIndex
CREATE INDEX "Hire_campaignerId_idx" ON "Hire"("campaignerId");

-- CreateIndex
CREATE INDEX "HireCreator_creatorId_idx" ON "HireCreator"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "HireCreator_hireId_creatorId_key" ON "HireCreator"("hireId", "creatorId");

-- CreateIndex
CREATE INDEX "SourceAsset_campaignId_idx" ON "SourceAsset"("campaignId");

-- CreateIndex
CREATE INDEX "SourceAsset_ownerId_idx" ON "SourceAsset"("ownerId");

-- CreateIndex
CREATE INDEX "VideoJob_campaignId_idx" ON "VideoJob"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_campaignId_creatorId_key" ON "Deal"("campaignId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Appeal_submissionId_key" ON "Appeal"("submissionId");

-- CreateIndex
CREATE INDEX "Appeal_campaignerId_idx" ON "Appeal"("campaignerId");

-- CreateIndex
CREATE INDEX "Appeal_stage_status_idx" ON "Appeal"("stage", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorStatus_userId_key" ON "CreatorStatus"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_code_key" ON "ReferralLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_referrerId_campaignId_key" ON "ReferralLink"("referrerId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_refereeId_key" ON "ReferralAttribution"("refereeId");

-- CreateIndex
CREATE INDEX "ReferralAttribution_referrerId_idx" ON "ReferralAttribution"("referrerId");

-- CreateIndex
CREATE INDEX "ReferralCredit_referrerId_createdAt_idx" ON "ReferralCredit"("referrerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferrerState_userId_key" ON "ReferrerState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OnchainProfile_userId_key" ON "OnchainProfile"("userId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_campaignerId_fkey" FOREIGN KEY ("campaignerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewSnapshot" ADD CONSTRAINT "ViewSnapshot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewSnapshot" ADD CONSTRAINT "ViewSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

