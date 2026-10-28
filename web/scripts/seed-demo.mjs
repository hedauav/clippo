// Demo dataset seeder. Usage:
//   node --env-file-if-exists=.env.local --env-file-if-exists=.env scripts/seed-demo.mjs [--reset] [--ui-only]
//
// Writes explicit, clearly-labelled SEED rows straight into the real database through Prisma (the same schema the API
// uses). It never calls a mock and never invents chain state:
//   * Everything is labelled: titles start with "[SEED] ", wallets are 0x5eed..., channel handles start with "seed_",
//     verdict reasons / appeal notes say "seed data".
//   * Rows that depend on the escrow chain (FUNDED/APPROVED campaigns with onchainId + fundTxHash, payouts) are written
//     ONLY when ESCROW_ADDRESS is configured, and then only as the placeholders the indexer will reconcile
//     (no tx hashes are made up: fundTxHash/onchainId stay null; run `POST /api/chain/sync` after real funding).
//     Without ESCROW_ADDRESS they are skipped with a message.
//   * --ui-only (local DB only, 127.0.0.1/localhost, never NODE_ENV=production) marks the campaigns APPROVED with NO chain
//     fields so the browse/slip/desk/bench screens can be laid out and screenshotted. These are not fundable or claimable.
//   * --reset deletes every SEED row first (idempotent re-seed). Without it existing seed rows are left in place.
// Needs DATABASE_URL. Safe to re-run.
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const REAL_URL = process.env.DATABASE_URL;
if (!REAL_URL) {
  console.error("DATABASE_URL is not set. Start the local DB (`npm run db:local`) or point at Postgres, then retry.");
  process.exit(1);
}
const RESET = process.argv.includes("--reset");
const UI_ONLY = process.argv.includes("--ui-only");
const CHAIN = Boolean(process.env.ESCROW_ADDRESS?.trim());
const LOCAL_DB = /@(127\.0\.0\.1|localhost)[:/]/.test(REAL_URL);
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed with NODE_ENV=production.");
  process.exit(1);
}
if (UI_ONLY && !LOCAL_DB) {
  console.error("--ui-only is only allowed against a local database (127.0.0.1 / localhost).");
  process.exit(1);
}

const db = new PrismaClient();
const TAG = "[SEED] ";
const wallet = (n) => `0x5eed${String(n).padStart(36, "0")}`.slice(0, 42);
const W = { admin: wallet(1), brand1: wallet(2), brand2: wallet(3), c1: wallet(11), c2: wallet(12), c3: wallet(13), c4: wallet(14), c5: wallet(15) };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const token = () => randomBytes(18).toString("base64url");

async function reset() {
  const users = await db.user.findMany({ where: { wallet: { startsWith: "0x5eed" } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const camps = await db.campaign.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const cids = camps.map((c) => c.id);
  const subs = await db.submission.findMany({ where: { campaignId: { in: cids } }, select: { id: true } });
  const sids = subs.map((s) => s.id);
  const hires = await db.hire.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const lists = await db.shortlist.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } });
  const inC = { in: cids };
  await db.appeal.deleteMany({ where: { campaignId: inC } });
  await db.viewSnapshot.deleteMany({ where: { campaignId: inC } });
  await db.verdict.deleteMany({ where: { submissionId: { in: sids } } });
  await db.payout.deleteMany({ where: { campaignId: inC } });
  await db.dealTerms.deleteMany({ where: { campaignId: inC } });
  await db.deal.deleteMany({ where: { campaignId: inC } });
  await db.submission.deleteMany({ where: { id: { in: sids } } });
  await db.hireCreator.deleteMany({ where: { hireId: { in: hires.map((h) => h.id) } } });
  await db.hire.deleteMany({ where: { id: { in: hires.map((h) => h.id) } } });
  await db.shortlistItem.deleteMany({ where: { shortlistId: { in: lists.map((l) => l.id) } } });
  await db.shortlist.deleteMany({ where: { id: { in: lists.map((l) => l.id) } } });
  await db.hireBrief.deleteMany({ where: { title: { startsWith: TAG } } });
  await db.campaign.deleteMany({ where: { id: inC } });
  await db.notification.deleteMany({ where: { userId: { in: uids } } });
  await db.creatorStatus.deleteMany({ where: { userId: { in: uids } } });
  await db.creatorProfile.deleteMany({ where: { userId: { in: uids } } });
  await db.channel.deleteMany({ where: { userId: { in: uids } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  console.log(`reset: removed ${users.length} seed users, ${cids.length} seed campaigns`);
}

async function user(role, w, i, verified) {
  return db.user.upsert({
    where: { wallet: w },
    update: {},
    create: { role, wallet: w, verified, worldIdNullifier: verified ? `seed-nullifier-${i}` : null },
  });
}

const story = (topic, summary, extra = {}) => ({
  summary,
  topic,
  requiredPoints: ["Show the product on screen", "Say the campaign name aloud"],
  prohibitedClaims: ["Guaranteed returns", "Medical claims"],
  disclosureLabel: "#ad",
  attribution: "Seed data: not a real brand",
  description: `${summary} (seed data for the demo)`,
  ...extra,
});

async function main() {
  console.log(`seed-demo: db=${LOCAL_DB ? "local" : "remote"} chain=${CHAIN ? "ESCROW_ADDRESS set" : "not configured"} ui-only=${UI_ONLY}`);
  if (RESET) await reset();

  // ---- people ----
  await user("ADMIN", W.admin, 1, true);
  const brand1 = await user("CAMPAIGNER", W.brand1, 2, true);
  const brand2 = await user("CAMPAIGNER", W.brand2, 3, true);
  const creators = [];
  const names = [
    ["c1", "Maya Okafor", "seed_maya", ["finance", "fintech"], 11, true],
    ["c2", "Jonas Berg", "seed_jonas", ["gaming", "tech"], 12, true],
    ["c3", "Priya Nair", "seed_priya", ["fitness", "lifestyle"], 13, true],
    ["c4", "Leo Duarte", "seed_leo", ["food", "travel"], 14, true],
    ["c5", "Sam Whitlock", "seed_sam", ["tech"], 15, false], // unverified on purpose: shows the gate
  ];
  for (const [k, display, handle, niches, n, verified] of names) {
    const u = await user("CREATOR", W[k], n, verified);
    const ch = await db.channel.upsert({
      where: { platform_handle: { platform: "YOUTUBE", handle } },
      update: {},
      create: { userId: u.id, platform: "YOUTUBE", handle, externalId: `seed-yt-${n}`, verificationCode: "clippo-seed", verified },
    });
    await db.creatorProfile.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id,
        displayName: `${display} (seed)`,
        bio: `Seed profile: ${niches.join(", ")} clips. Not a real person.`,
        niches,
        rateCard: [
          { label: "30s YouTube Short", platform: "YOUTUBE", price: 150 + n * 5 },
          { label: "Long-form mention", platform: "YOUTUBE", price: 400 + n * 10 },
        ],
        listed: verified,
      },
    });
    creators.push({ ...u, channel: ch, display });
  }
  const [c1, c2, c3, c4] = creators;

  // ---- campaigns (one per payout mode, plus a draft and a rejected one) ----
  const existing = await db.campaign.findMany({ where: { title: { startsWith: TAG } }, select: { id: true, title: true } });
  const has = (t) => existing.find((e) => e.title === TAG + t);
  const mk = async (title, data) => {
    const found = has(title);
    if (found) return db.campaign.findUnique({ where: { id: found.id } });
    return db.campaign.create({ data: { title: TAG + title, platforms: ["YOUTUBE"], contentSource: "LINK", contentUrl: "https://example.com/seed-brief", ...data } });
  };
  // DRAFT needs no chain at all.
  await mk("Draft: Winter capsule teaser", {
    campaignerId: brand2.id, payoutMode: "PER_VIEW", ratePer1k: 4, poolSize: 600, viewTarget: 150000, status: "DRAFT",
    story: story("fashion", "A 20s teaser for a seed winter capsule collection."),
  });
  const canLive = CHAIN || UI_ONLY;
  const live = canLive ? (CHAIN ? "FUNDED" : "APPROVED") : null; // with a real chain, FUNDED waits for the real indexer/admin approve
  let perView, humanSplit, poolShare;
  if (canLive) {
    perView = await mk("Per-view: LedgerLane budgeting app", {
      campaignerId: brand1.id, payoutMode: "PER_VIEW", ratePer1k: 5, poolSize: 2500, viewTarget: 500000, status: live,
      story: story("personal finance", "Show how LedgerLane splits a paycheck into envelopes in under 30 seconds."),
    });
    humanSplit = await mk("Human split: Trailhead launch film", {
      campaignerId: brand1.id, payoutMode: "HUMAN_SPLIT", approver: "CAMPAIGNER_AND_ADMIN", poolSize: 4000, status: live,
      story: story("outdoor gear", "Cut the best 45s clips from the Trailhead launch film; the AI proposes the split, a human releases it."),
    });
    poolShare = await mk("Pool share: Pocket Chess Club", {
      campaignerId: brand2.id, payoutMode: "POOL_SHARE", poolShareBasis: "VIEWS", poolSize: 1800, status: live,
      story: story("games", "Make a Short about your best Pocket Chess Club comeback."),
    });
    await mk("Rejected: Miracle supplement", {
      campaignerId: brand2.id, payoutMode: "PER_VIEW", ratePer1k: 9, poolSize: 900, status: "REJECTED",
      rejectReason: "Seed data: prohibited health claims in the brief; full pool refunded in the real flow.",
      story: story("supplements", "Seed campaign rejected by the admin for medical claims."),
    });
  } else {
    console.log("SKIP: APPROVED/FUNDED/REJECTED campaigns, submissions, snapshots, payouts: they depend on the escrow chain. Set ESCROW_ADDRESS (and fund/approve for real), or use --ui-only on a local DB to lay out screens.");
  }

  // ---- submissions, verdicts, appeal, snapshots (attached to the campaigns above) ----
  let nSub = 0;
  if (canLive) {
    const sub = async (camp, creator, vid, title, result, confidence, reason, extra = {}) => {
      const link = `https://www.youtube.com/watch?v=${vid}`;
      const s = await db.submission.upsert({
        where: { campaignId_videoId: { campaignId: camp.id, videoId: vid } },
        update: {},
        create: {
          campaignId: camp.id, creatorId: creator.id, channelId: creator.channel.id, link, videoId: vid,
          transcript: `Seed transcript for "${title}".`, metadata: { title: `[SEED] ${title}`, description: "Seed data", views: 0, publishedAt: new Date().toISOString() },
        },
      });
      await db.verdict.upsert({
        where: { submissionId: s.id },
        update: {},
        create: { submissionId: s.id, result, confidence, reason: `Seed data: ${reason}`, flags: extra.flags ?? [], decidedBy: extra.decidedBy ?? "AI", appealStatus: extra.appealStatus ?? "NONE", appealNote: extra.appealNote },
      });
      nSub++;
      return s;
    };
    const days = [-6, -5, -4, -3, -2, -1, 0];
    const snap = async (s, camp, creator, base, growth) => {
      let cum = 0;
      for (let i = 0; i < days.length; i++) {
        cum += Math.round(base * (1 + i * growth));
        await db.viewSnapshot.upsert({
          where: { submissionId_day: { submissionId: s.id, day: day(days[i]) } },
          update: {},
          create: { campaignId: camp.id, submissionId: s.id, creatorId: creator.id, day: day(days[i]), cumulativeViews: cum },
        });
      }
    };
    const a1 = await sub(perView, c1, "seedApprove01", "Envelope budgeting in 30s", "APPROVE", 0.93, "covers required points, disclosure present");
    const a2 = await sub(perView, c2, "seedApprove02", "I tried LedgerLane for a week", "APPROVE", 0.88, "on topic, #ad shown");
    const r1 = await sub(perView, c3, "seedReject001", "Get rich with LedgerLane", "REJECT", 0.9, "makes a prohibited guaranteed-returns claim", { flags: ["prohibited_claim"], appealStatus: "PENDING", appealNote: "Seed appeal: the line is a joke, I say so on screen." });
    await sub(perView, c4, "seedHuman0001", "LedgerLane vs spreadsheets", "NEEDS_HUMAN", 0.52, "transcript unreadable in the first 10s, needs a person", { flags: ["unreadable"] });
    const a3 = await sub(humanSplit, c1, "seedApprove03", "Trailhead launch cut A", "APPROVE", 0.91, "matches brief");
    const a4 = await sub(humanSplit, c2, "seedApprove04", "Trailhead launch cut B", "APPROVE", 0.86, "matches brief");
    const a5 = await sub(poolShare, c4, "seedApprove05", "Pocket Chess comeback", "APPROVE", 0.9, "on topic");
    await snap(a1, perView, c1, 2400, 0.25);
    await snap(a2, perView, c2, 1300, 0.1);
    await snap(a3, humanSplit, c1, 3100, 0.2);
    await snap(a4, humanSplit, c2, 900, 0.3);
    await snap(a5, poolShare, c4, 1700, 0.15);
    // The appeal row for the rejected clip (campaigner stage, within SLA).
    if (!(await db.appeal.findUnique({ where: { submissionId: r1.id } }))) {
      const v = await db.verdict.findUnique({ where: { submissionId: r1.id } });
      await db.appeal.create({
        data: { submissionId: r1.id, verdictId: v.id, campaignId: perView.id, creatorId: c3.id, campaignerId: brand1.id, note: "Seed appeal: the line is a joke, I say so on screen.", dueAt: new Date(Date.now() + 72 * 3600000) },
      });
    }
  }

  // ---- hire workspace (no chain involved until "fund all") ----
  const hireTitle = TAG + "Hire: Spring launch creators";
  let hire = await db.hire.findFirst({ where: { title: hireTitle } });
  if (!hire) {
    const brief = await db.hireBrief.create({
      data: { campaignerId: brand1.id, title: TAG + "Spring launch brief", story: story("fintech", "Two short clips introducing LedgerLane to first-time budgeters."), deliverables: ["One 30s YouTube Short", "One pinned comment with the link"], platforms: ["YOUTUBE"], deadline: day(21), notes: "Seed brief." },
    });
    hire = await db.hire.create({ data: { campaignerId: brand1.id, briefId: brief.id, title: hireTitle, shareToken: token() } });
    await db.hireCreator.createMany({
      data: [
        { hireId: hire.id, creatorId: c1.id, rateLabel: "30s YouTube Short", quantity: 2, amount: 2 * (150 + 55), status: "APPROVED" },
        { hireId: hire.id, creatorId: c3.id, rateLabel: "30s YouTube Short", quantity: 1, amount: 150 + 65, status: "PROPOSED" },
        { hireId: hire.id, creatorId: c4.id, rateLabel: "Long-form mention", quantity: 1, amount: 400 + 140, status: "PROPOSED" },
      ],
    });
  }
  let list = await db.shortlist.findFirst({ where: { title: TAG + "Shortlist: fintech voices" } });
  if (!list) {
    list = await db.shortlist.create({ data: { ownerId: brand1.id, title: TAG + "Shortlist: fintech voices", shareToken: token() } });
    await db.shortlistItem.createMany({ data: [c1, c2].map((c) => ({ shortlistId: list.id, creatorId: c.id, note: "Seed note" })) });
  }

  console.log("\nSeed done.");
  console.log(`  users: admin ${W.admin}, campaigners ${W.brand1} ${W.brand2}, creators ${[W.c1, W.c2, W.c3, W.c4, W.c5].join(" ")}`);
  console.log(`  campaigns: ${canLive ? "DRAFT + 3 modes (+1 rejected)" : "DRAFT only"}; submissions: ${nSub} (APPROVE/REJECT/NEEDS_HUMAN, 1 pending appeal); hire: ${hire.id}; share /hire/share/${hire.shareToken}; shortlist /hire/lists/${list.shareToken}`);
  console.log("  dev sign-in (NODE_ENV != production): POST /api/auth/session {wallet, role}. Add the admin wallet to ADMIN_WALLETS to act as admin.");
  if (CHAIN && !UI_ONLY) console.log("  chain: campaigns are FUNDED placeholders with no onchainId/tx hash; fund and approve for real, then POST /api/chain/sync.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
