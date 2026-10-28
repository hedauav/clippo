import { z } from "zod";
import type { LlmClient } from "../ai/llm";
import { detectInjection, type Story } from "../ai/verifier";
import { PLATFORM_NAMES, getPlatform, type PlatformName } from "../platforms";
import { askJson, round2, wrapData } from "./ask";

/* ---------------- explain brief ---------------- */

export interface BriefExplanation {
  plain: string;
  doList: string[];
  avoidList: string[];
  label: string;
}

export async function explainBrief(story: Story, llm: LlmClient) {
  const fallback: BriefExplanation = {
    plain: `${story.summary.replace(/\.$/, "")}. Make one short clip about ${story.topic}, say each required point in your own words, show the label "${story.disclosureLabel}" early${story.attribution ? ` and ${story.attribution.charAt(0).toLowerCase()}${story.attribution.slice(1)}` : ""}.`,
    doList: story.requiredPoints,
    avoidList: story.prohibitedClaims,
    label: story.disclosureLabel,
  };
  const r = await askJson<{ plain: string }>(
    llm,
    {
      system: `Rewrite the campaign brief as 2-3 plain sentences for a video creator. JSON: {"plain": string}. Do not invent requirements.`,
      user: wrapData("BRIEF", JSON.stringify(story)),
      schema: z.object({ plain: z.string().max(800).optional() }),
      maxTokens: 300,
      surfaceQuota: true,
    },
    { plain: fallback.plain },
  );
  return { explanation: { ...fallback, plain: r.value.plain }, usedLlm: r.usedLlm };
}

/* ---------------- pre-submit rejection risk ---------------- */

export interface Risk {
  level: "block" | "warn" | "note";
  text: string;
  rule: string;
}

export interface PrecheckInput {
  story: Story;
  /** Everything the creator pasted: caption, script, transcript. */
  text: string;
  link?: string;
  campaignPlatforms: string[];
}

const STOP = new Set("this that with from have your about they their will what when then them been were would there which into just like more some also than very over only".split(" "));
const keywords = (s: string) => (s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w));

/** Deterministic rejection-risk check mirroring what the verifier looks at (topic, points, claims, label, attribution). */
export function precheck(input: PrecheckInput): Risk[] {
  const { story } = input;
  const risks: Risk[] = [];
  const text = input.text.toLowerCase();

  if (input.link?.trim()) {
    const platform = PLATFORM_NAMES.find((p) => getPlatform(p).parseVideoId(input.link!));
    if (!platform) risks.push({ level: "block", text: "This link is not a YouTube, X or Instagram video, so it cannot be submitted.", rule: "Platforms" });
    else {
      if (!input.campaignPlatforms.includes(platform)) risks.push({ level: "block", text: `This campaign does not accept ${platform} clips.`, rule: "Platforms" });
      if (platform !== "YOUTUBE") risks.push({ level: "note", text: `${platform} clips often cannot be read automatically; expect a human review rather than an instant verdict.`, rule: "Review" });
    }
  }

  if (!text.trim()) {
    risks.push({ level: "note", text: "Paste your caption, script or transcript to get a content check. The agent still reads the clip itself.", rule: "Input" });
    return risks;
  }

  if (detectInjection(input.text)) {
    risks.push({ level: "block", text: "The text contains wording that tries to instruct the reviewing agent. Clip text is treated as data only and this will be sent to human review.", rule: "Integrity" });
  }

  const label = story.disclosureLabel.trim().toLowerCase();
  if (label && !text.includes(label) && !text.includes("sponsored") && !text.includes("#ad")) {
    risks.push({ level: "block", text: `No disclosure label found. The brief requires: ${story.disclosureLabel}.`, rule: "Disclosure" });
  }

  for (const p of story.prohibitedClaims.filter(Boolean)) {
    if (text.includes(p.toLowerCase())) risks.push({ level: "block", text: `Contains a prohibited claim: "${p}".`, rule: "Must not say" });
  }

  const missing = story.requiredPoints.filter((p) => {
    const kws = keywords(p);
    if (!kws.length) return false;
    const hit = kws.filter((k) => text.includes(k)).length;
    return hit / kws.length < 0.34;
  });
  for (const p of missing) risks.push({ level: "warn", text: `Does not seem to cover: ${p}. Say it out loud in the clip, since the agent reads the transcript.`, rule: "Must say" });

  const attributionKw = keywords(story.attribution);
  if (attributionKw.length && !attributionKw.some((k) => text.includes(k)) && !/credit|source|original|via/.test(text)) {
    risks.push({ level: "warn", text: `Attribution not found. The brief asks: ${story.attribution}.`, rule: "Attribution" });
  }

  const topicKw = keywords(`${story.topic} ${story.summary}`);
  if (topicKw.length && topicKw.filter((k) => text.includes(k)).length === 0) {
    risks.push({ level: "warn", text: "The text does not mention the campaign topic; the clip may look off-topic.", rule: "Topic" });
  }

  if (risks.length === 0) risks.push({ level: "note", text: "No obvious problems in what you pasted. The agent still reads the clip itself.", rule: "Clear" });
  return risks;
}

export const riskLevel = (r: Risk[]): "LOW" | "MEDIUM" | "HIGH" =>
  r.some((x) => x.level === "block") ? "HIGH" : r.some((x) => x.level === "warn") ? "MEDIUM" : "LOW";

/* ---------------- match campaigns ---------------- */

export interface MatchCandidate {
  id: string;
  title: string;
  topic: string;
  platforms: string[];
  payMode: string;
  ratePer1k: number | null;
  poolSize: number;
  eligible: boolean;
}

export interface CreatorProfileSignal {
  channelPlatforms: string[];
  pastTopics: string[];
}

export interface Match {
  campaignId: string;
  title: string;
  fit: number;
  why: string;
  pays: string;
  platform: string;
}

const payText = (c: MatchCandidate) =>
  c.payMode === "PER_VIEW" && c.ratePer1k ? `$${c.ratePer1k.toFixed(2)} per 1K views` : `$${c.poolSize.toLocaleString("en-US")} pool, ${c.payMode === "POOL_SHARE" ? "shared" : "split by approval"}`;

export function matchCampaigns(profile: CreatorProfileSignal, campaigns: MatchCandidate[], limit = 5): Match[] {
  const past = new Set(profile.pastTopics.flatMap(keywords));
  const maxRate = Math.max(1, ...campaigns.map((c) => c.ratePer1k ?? 0));
  const scored = campaigns
    .filter((c) => c.eligible)
    .map((c) => {
      const usable = c.platforms.filter((p) => profile.channelPlatforms.includes(p));
      const platformScore = usable.length ? 0.45 : 0;
      const tk = keywords(c.topic);
      const overlap = tk.length ? tk.filter((k) => past.has(k)).length / tk.length : 0;
      const payScore = c.ratePer1k ? 0.15 * (c.ratePer1k / maxRate) : 0.08;
      const fit = round2(Math.min(0.99, 0.25 + platformScore + overlap * 0.3 + payScore));
      const reasons = [
        usable.length ? `You have a verified ${usable[0]} channel, which this brief allows.` : `Needs a verified ${c.platforms.join(" or ")} channel you have not added yet.`,
        overlap > 0 ? "Similar to topics in your approved clips." : "",
      ].filter(Boolean);
      return { campaignId: c.id, title: c.title, fit, why: reasons.join(" "), pays: payText(c), platform: (usable[0] ?? c.platforms[0] ?? "YOUTUBE") as PlatformName };
    })
    .sort((a, b) => b.fit - a.fit);
  return scored.slice(0, limit);
}
