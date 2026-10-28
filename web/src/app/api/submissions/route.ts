import { rateLimit } from "@/lib/ratelimit";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLlm } from "@/lib/ai/llm";
import { hashTranscript } from "@/lib/ai/duplicates";
import { verifyClip, type Story, type VerdictResultT } from "@/lib/ai/verifier";
import { storySchema } from "@/lib/domain";
import { assertCanSubmit } from "@/lib/workspace/eligibility";
import { assertVerifiedHuman } from "@/lib/worldid/signup";
import { ApiError, ok, readJson, route } from "@/lib/http";
import { fetchClip, getPlatform } from "@/lib/platforms";

const body = z.object({ campaignId: z.string().min(1), channelId: z.string().min(1), link: z.string().url() });

/** Submit a clip link: fetches transcript/metadata, runs the AI verifier, stores the verdict. */
export const POST = route(async (req: Request) => {
  await rateLimit(req, "submissions", 30, 3600);
  const user = await requireUser(req, ["CREATOR"]);
  assertVerifiedHuman(user, "submissions");
  const v = body.parse(await readJson(req));

  const campaign = await db.campaign.findUnique({ where: { id: v.campaignId } });
  if (!campaign || campaign.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Campaign not open for submissions");
  const platforms = campaign.platforms as string[];
  await assertCanSubmit(user, campaign); // HIGHER_RANKED tier rule + hired-creator allowlist (workspace/eligibility)

  const channel = await db.channel.findUnique({ where: { id: v.channelId } });
  if (!channel || channel.userId !== user.id) throw new ApiError(404, "NOT_FOUND", "Channel not found");
  if (!channel.verified) throw new ApiError(403, "CHANNEL_UNVERIFIED", "Verify channel ownership first");
  if (!platforms.includes(channel.platform)) throw new ApiError(400, "UNSUPPORTED_PLATFORM", `This campaign does not accept ${channel.platform} clips`);
  const adapter = getPlatform(channel.platform);

  const videoId = adapter.parseVideoId(v.link);
  if (!videoId) throw new ApiError(400, "BAD_LINK", `Not a valid ${channel.platform} video link`);
  if (await db.submission.findUnique({ where: { campaignId_videoId: { campaignId: campaign.id, videoId } } })) {
    throw new ApiError(409, "DUPLICATE_LINK", "This video was already submitted to the campaign");
  }

  let outcome;
  try {
    outcome = await fetchClip(channel.platform, v.link, { channelHandle: channel.handle, channelId: channel.id });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, "VIDEO_UNREADABLE", e instanceof Error ? e.message : "Could not read video");
  }

  let verdict: { result: VerdictResultT; confidence: number; reason: string; flags: string[] };
  let video = { title: "", description: "", views: 0 as number, publishedAt: null as string | null, transcript: null as string | null };
  if (!outcome.readable) {
    // PRD 4.7: a clip that cannot be read automatically goes to human review, never skipped or auto-approved.
    verdict = {
      result: "NEEDS_HUMAN",
      confidence: 0,
      reason: `This ${channel.platform} clip could not be read automatically (${outcome.reason}); a human will review it.`,
      flags: ["unreadable", "platform_unavailable"],
    };
  } else {
    video = outcome.video;
    const channelOwned =
      (!!outcome.video.channelExternalId && outcome.video.channelExternalId === channel.externalId) ||
      (!!outcome.video.channelHandle && outcome.video.channelHandle === adapter.normalizeHandle(channel.handle));
    const existing = await db.submission.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, transcript: true, transcriptHash: true },
    });
    const story = storySchema.parse(campaign.story) as Story;
    verdict = await verifyClip(
      { story, transcript: video.transcript, title: video.title, description: video.description, channelOwned, existing },
      getLlm(),
    );
  }

  const submission = await db.submission.create({
    data: {
      campaignId: campaign.id,
      creatorId: user.id,
      channelId: channel.id,
      link: v.link,
      videoId,
      transcript: video.transcript,
      transcriptHash: video.transcript ? hashTranscript(video.transcript) : null,
      metadata: { title: video.title, description: video.description, views: video.views, publishedAt: video.publishedAt },
      verdict: {
        create: { result: verdict.result, confidence: verdict.confidence, reason: verdict.reason, flags: verdict.flags },
      },
    },
    include: { verdict: true },
  });
  return ok({ submission, verdict: submission.verdict }, 201);
});

/** The signed-in creator's submissions with verdicts. */
export const GET = route(async (req: Request) => {
  const user = await requireUser(req, ["CREATOR"]);
  const submissions = await db.submission.findMany({
    where: { creatorId: user.id },
    orderBy: { createdAt: "desc" },
    include: { verdict: true, campaign: { select: { id: true, title: true, status: true } } },
  });
  return ok({ submissions });
});
