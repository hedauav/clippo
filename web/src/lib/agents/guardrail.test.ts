import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANTS_CANNOT_MOVE_FUNDS } from "./ask";

const SRC = path.resolve(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Remove comments and string/template literal contents so only executable identifiers remain. */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");

const isTest = (f: string) => /\.test\.ts$/.test(f);
const read = (f: string) => code(readFileSync(f, "utf8"));

describe("guardrail: no assistant code path can release funds (PRD 4.8)", () => {
  const agentFiles = walk(path.join(SRC, "lib/agents")).filter((f) => !isTest(f));
  const assistantRoutes = [
    ...walk(path.join(SRC, "app/api/assistant")),
    ...walk(path.join(SRC, "app/api/wizard")),
    ...walk(path.join(SRC, "app/api/campaigns")).filter((f) => f.includes(`${path.sep}deal${path.sep}`)),
  ].filter((f) => f.endsWith(".ts") && !isTest(f));
  const dealLib = [path.join(SRC, "lib/deals.ts")];

  it("constant is set and the file lists are non-empty", () => {
    expect(ASSISTANTS_CANNOT_MOVE_FUNDS).toBe(true);
    expect(agentFiles.length).toBeGreaterThanOrEqual(4);
    expect(assistantRoutes.length).toBeGreaterThanOrEqual(8);
  });

  it("agent modules are pure: no database, chain, earnings or payout access", () => {
    for (const f of agentFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*(\/db|chain|earnings|snapshots|payouts?)["']/);
      expect(read(f), f).not.toMatch(/\b(db|prisma|PrismaClient)\b/);
      expect(read(f), f).not.toMatch(/\b(payout|claim|release|withdraw|transfer|writeContract|sendTransaction)\w*/i);
    }
  });

  it("assistant, wizard and deal code never writes payouts, imports chain/earnings, or calls claim/fund/release endpoints", () => {
    for (const f of [...assistantRoutes, ...dealLib]) {
      const src = readFileSync(f, "utf8");
      const c = read(f);
      expect(src, f).not.toMatch(/from\s+["'][^"']*(lib\/chain|lib\/earnings|\/chain\/)/);
      expect(c, f).not.toMatch(/\.payout\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
      expect(c, f).not.toMatch(/\b(writeContract|sendTransaction|releasePayout|claimPayout)\b/);
      expect(src, f).not.toMatch(/\/api\/(payouts|campaigns\/[^"'`]*\/(fund|split|close))/);
    }
  });

  it("the only db models agents-related routes mutate are advisory (Deal, DealTerms, Notification, fraud hold)", () => {
    const allowed = new Set(["deal", "dealTerms", "notification", "fraudFlag"]);
    for (const f of [...assistantRoutes, ...dealLib]) {
      for (const m of read(f).matchAll(/\bdb\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) {
        expect(allowed.has(m[1]), `${path.relative(SRC, f)} mutates db.${m[1]}`).toBe(true);
      }
    }
  });
});

describe("guardrail: the Agent Pass split proposer can only propose, never release (PRD 4.8, World Agent Pass)", () => {
  const agentPassLib = walk(path.join(SRC, "lib/agentpass")).filter((f) => f.endsWith(".ts") && !isTest(f));
  const agentRoutes = [
    ...walk(path.join(SRC, "app/api/campaigns")).filter((f) => f.split(path.sep).join("/").match(/\/\[id\]\/(agent\/|split\/(propose|audit)\/)/)),
    ...walk(path.join(SRC, "app/api/admin/agent-pass")),
  ].filter((f) => f.endsWith(".ts") && !isTest(f));
  const splitRoute = path.join(SRC, "app/api/campaigns/[id]/split/route.ts");

  it("file lists are non-empty", () => {
    expect(agentPassLib.length).toBeGreaterThanOrEqual(4);
    expect(agentRoutes.length).toBeGreaterThanOrEqual(4);
  });

  it("the pure agent modules (signer/planner and the Claude proposer) have no database, chain client, escrow, earnings or proof access", () => {
    for (const name of ["agent.ts", "llm-proposer.ts"]) {
      const f = path.join(SRC, "lib/agentpass", name);
      const src = readFileSync(f, "utf8");
      expect(src, name).not.toMatch(/from\s+["'][^"']*(\/db|\/chain\/(client|clients|escrow|reader|signer|indexer)|earnings|worldid|snapshots|\/config)["']/);
      expect(read(f), name).not.toMatch(/\b(db|prisma|PrismaClient|checkFreshProof|consumeProof|fetch|getLlm)\b/);
      expect(read(f), name).not.toMatch(/\b(payout|claim|release|withdraw|transfer|writeContract|sendTransaction)\w*/i);
    }
  });

  it("the Claude proposer receives its LLM client by injection and enforces constraints in code", () => {
    const src = readFileSync(path.join(SRC, "lib/agentpass/llm-proposer.ts"), "utf8");
    expect(src).toMatch(/llm: LlmClient/);
    expect(src).toMatch(/enforceConstraints\(/);
    expect(src).toMatch(/deterministicDraft\(/);
  });

  it("agent code and its routes never write payouts, split approvals, attestations or used proofs, and never call the chain", () => {
    for (const f of [...agentPassLib, ...agentRoutes]) {
      const src = readFileSync(f, "utf8");
      const c = read(f);
      expect(src, f).not.toMatch(/from\s+["'][^"']*(lib\/chain\/(client|clients|escrow|reader|signer|indexer)|\/earnings|worldid\/fresh)["']/);
      expect(c, f).not.toMatch(/\b(writeContract|sendTransaction|releasePayout|claimPayout|checkFreshProof|consumeProof)\b/);
      for (const m of c.matchAll(/\bdb\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) {
        expect(["agentIdentity", "agentProposal", "agentAudit"].includes(m[1]!), `${path.relative(SRC, f)} mutates db.${m[1]}`).toBe(true);
      }
      for (const m of c.matchAll(/\btx\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) {
        expect(["agentIdentity", "agentProposal", "agentAudit"].includes(m[1]!), `${path.relative(SRC, f)} mutates tx.${m[1]}`).toBe(true);
      }
    }
  });

  it("the only code that creates a split approval first verifies and consumes a fresh World ID proof", () => {
    const c = read(splitRoute);
    const check = c.indexOf("checkFreshProof(");
    const consume = c.indexOf("consumeProof(");
    const create = c.indexOf("splitProposal.create");
    expect(check).toBeGreaterThan(0);
    expect(consume).toBeGreaterThan(check);
    expect(create).toBeGreaterThan(consume);
    expect(c).not.toMatch(/\.payout\.(create|createMany|update|updateMany|upsert)\(/); // payouts come only from the on-chain event indexer
  });
});
