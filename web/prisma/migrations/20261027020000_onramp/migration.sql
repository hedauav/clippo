-- CreateTable
CREATE TABLE "OnrampOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "providerOrderId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnrampOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnrampOrder_userId_idx" ON "OnrampOrder"("userId");
