-- CreateTable
CREATE TABLE "AgentIdentity" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "humanId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "splitHash" TEXT NOT NULL,
    "splits" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAudit" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "proposalId" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "event" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "code" TEXT,
    "detail" TEXT NOT NULL,
    "splitHash" TEXT,
    "proofStatus" TEXT,
    "source" TEXT NOT NULL DEFAULT 'server',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentIdentity_campaignId_idx" ON "AgentIdentity"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentIdentity_campaignId_address_key" ON "AgentIdentity"("campaignId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProposal_nonce_key" ON "AgentProposal"("nonce");

-- CreateIndex
CREATE INDEX "AgentProposal_campaignId_status_idx" ON "AgentProposal"("campaignId", "status");

-- CreateIndex
CREATE INDEX "AgentAudit_campaignId_createdAt_idx" ON "AgentAudit"("campaignId", "createdAt");
