# Architecture

## System

```mermaid
flowchart LR
  subgraph Users
    CAMP[Campaigner]
    CRE_USER[Creator]
    ADM[Admin]
  end
  subgraph Web["web/ (Next.js)"]
    UI[Frontend pages + components]
    API["/api routes"]
    DB[(Prisma DB<br/>SQLite local)]
    AI["AI verifier + campaign writer<br/>(Claude)"]
    WID["World ID verifier<br/>(Developer Portal v4)"]
    PLAT["Platform adapter<br/>YouTube, X, Instagram (real APIs)"]
  end
  subgraph Arc["Arc testnet"]
    ESC[ClippoEscrow]
    RCV[ClippoReportReceiver]
    USDC[(USDC)]
    FWD[CRE Forwarder]
  end
  CRE["Chainlink CRE workflow<br/>clippo-settlement (cron)"]
  WORLD["World: IDKit / Agent Pass"]
  YT[YouTube Data API]

  CAMP & CRE_USER & ADM --> UI
  UI --> API
  API --> DB
  API --> AI
  API --> PLAT --> YT
  UI -. proof .-> WORLD
  API --> WID --> WORLD
  UI -. "fund/claim/close" .-> ESC
  ESC --- USDC
  CRE -- "GET /api/snapshots/latest" --> API
  CRE -- "signed report" --> FWD --> RCV --> ESC
```

Dotted links are not implemented against real services in the current build (see the README status table).

## Money flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Campaigner
  participant W as Web/API/DB
  participant E as ClippoEscrow (Arc)
  participant A as Admin
  participant V as AI verifier
  participant C as Creator
  participant R as CRE + Receiver

  B->>W: Create campaign (DRAFT)
  B->>E: approve USDC, createCampaign (Funded, fee held)
  B->>W: POST /campaigns/:id/fund (onchainId, tx) [state mirror]
  A->>E: approveCampaign (Approved, fee to treasury)
  A->>W: POST /campaigns/:id/approve (APPROVED)
  C->>W: POST /submissions (link)
  W->>V: transcript + story
  V-->>W: APPROVE / REJECT / NEEDS_HUMAN
  W->>W: store verdict + daily view snapshot
  R->>W: GET /snapshots/latest (cron)
  R->>E: report via forwarder -> reportViews (credits delta, capped by pool)
  C->>E: claim(id) (net of creator fee)
  C->>W: POST /payouts/:id/claim [state mirror]
  B->>E: closeCampaign (unspent returns to campaigner)
```

What is real in this flow:

- Every step on `ClippoEscrow` is implemented and tested in `contracts/`. From the web app they are currently simulated by `useEscrow()` (fake tx hashes); the API only mirrors state.
- HumanSplit: `POST /api/campaigns/:id/split` requires a fresh World ID proof (the Agent Pass step) and creates PENDING payouts in the DB. The backend does not call on-chain `approveSplit`.
- Reject path: `rejectCampaign` on-chain refunds the full pool including the held fee.
- Known gap: `/api/snapshots/latest` returns `campaignId` (DB cuid) and `onchainId`. The CRE `snapshot.ts` drops rows whose `campaignId` is not a uint256, so the endpoint must emit the numeric `onchainId` as the id (or the workflow must read `onchainId`) before a live run works. Verify before demoing.

## Components to files

| Component | Files |
| --- | --- |
| Frontend | `web/src/app/(site)/*`, `web/src/components/*`, data seam `components/api.ts` |
| API | `web/src/app/api/**/route.ts`, `web/src/lib/{auth,http,domain,earnings,snapshots}.ts` |
| DB | `web/prisma/schema.prisma` (User, Channel, Campaign, Submission, Verdict, ViewSnapshot, Payout) |
| AI verifier | `web/src/lib/ai/{verifier,llm,duplicates,campaign-writer}.ts` |
| World ID | `web/src/lib/worldid/index.ts`, `web/src/app/api/worldid/verify/route.ts`, `components/WorldCheck.tsx` |
| Platforms | `web/src/lib/youtube/index.ts` |
| Escrow | `contracts/src/ClippoEscrow.sol`, `ClippoReportReceiver.sol`, `MockUSDC.sol`, `script/Deploy.s.sol` |
| CRE | `cre/workflows/clippo-settlement/{main,snapshot}.ts` |
