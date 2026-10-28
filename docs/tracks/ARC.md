# Arc track: Smart Contracts with Advanced Stablecoin Logic

Researched 2026-10-28. Prize $3k per the PRD. Status key: DONE (in repo), MANUAL (user must do), UNVERIFIED.

## Sources
- Arc docs index: https://docs.arc.io/llms.txt
- Connect to Arc: https://docs.arc.io/integrate/connect-to-arc and https://docs.arc.io/arc/references/rpc-endpoints.md
- Contract addresses: https://docs.arc.io/arc/references/contract-addresses
- Arc Studio: https://docs.arc.io/ai/arc-studio.md and CLI https://docs.arc.io/ai/arc-studio-cli.md
- ETHGlobal Cannes 2026 Arc prize (same four-bounty set; the Mumbai page returned 404): https://ethglobal.com/events/cannes2026/prizes/arc
- Arc winners blog (judging wording): https://www.arc.io/blog/meet-the-arc-track-winners-from-ethglobal-cannes-hackathon-and-what-we-learned

## Network facts (official docs.arc.io)
| Item | Value |
| --- | --- |
| Chain ID | 5042002 |
| Primary RPC | https://rpc.testnet.arc.io (WS wss://rpc.testnet.arc.io). The older host rpc.testnet.arc.network also answers (docs.arc.network 301-redirects to docs.arc.io). Alternates: rpc.blockdaemon / rpc.drpc / rpc.quicknode .testnet.arc.io |
| Explorer | https://explorer.testnet.arc.io (older: testnet.arcscan.app). Gas tracker at /gas-tracker |
| Faucet | https://faucet.circle.com (Studio also has a built-in faucet). Third-party report: 20 USDC per 2 h per address, UNVERIFIED |
| USDC | 0x3600000000000000000000000000000000000000 (testnet and mainnet) |
| EURC (testnet) | 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a |
| Decimals | Native gas balance 18 decimals; ERC-20 interface 6 decimals. Same balance, show one USDC row. Use only the ERC-20 interface (6) for transfers and balances |
| CCTP | domain 26; TokenMessengerV2 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA; MessageTransmitterV2 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 |
| Gateway | GatewayWallet 0x0077777d7EBA4688BDeF3E311b846F25870A19B9; GatewayMinter 0x0022222ABE238Cc2C7Bb1f21003F0a260052475B |

Gas semantics: fees are paid in USDC, so a campaigner or creator needs only USDC. One faucet drop covers both campaign funding and gas.

## Arc Studio
- Web app: https://studio.arc.io/ (docs describe no login flow; expect an account or wallet sign-in, UNVERIFIED).
- Prompt to full-stack app: plans, generates, compiles and deploys Solidity to Arc testnet only (never mainnet), live sandbox with real testnet transactions, chat refinement, built-in faucet, wallet connect.
- Export: "Push to GitHub". CLI `@circle-fin/arc-studio-cli` (`npm i -g`, Node 20+): `arc-studio login`, `arc-studio run "<prompt>" --file src/X.sol` (uploads existing code as context; this is the import path), `arc-studio pull --out ./onchain --paths "contracts/**"` (export), `arc-studio deployments`, `arc-studio clone <public github repo>`.
- No documented "import project" button; the supported import is `--file` context or `clone`. Web UI import UNVERIFIED.
- Studio warns generated code must be reviewed before use.

## Prize requirements checklist
The Mumbai page was not reachable (404 at ethglobal.com/events/mumbai2026/prizes/arc). Requirements below come from the Cannes 2026 Arc page (same track name) plus the PRD. Re-read the Mumbai page when live. Event dates reported as Nov 5-7 2026 (third-party).

| # | Requirement | Source | Status |
| --- | --- | --- | --- |
| 1 | Contracts on Arc using USDC/EURC beyond simple transfers (conditional escrow, payroll/vesting, crosschain conditional transfers) | Cannes Arc page | DONE: ClippoEscrow, three modes, fee split, refunds, retention, attestations |
| 2 | Functional MVP, working frontend and backend | Cannes Arc page | Web and API exist; on-chain flow works once deployed and ESCROW_ADDRESS set (MANUAL) |
| 3 | Architecture diagram | Cannes Arc page | MANUAL/TODO: draw from ARCHITECTURE.md (Studio -> repo -> Arc contracts; backend snapshot -> CRE -> ReportReceiver; web via viem) |
| 4 | Video demo and presentation of core functions and use of Circle tools | Cannes Arc page | MANUAL |
| 5 | GitHub/Replit repo link | Cannes Arc page | MANUAL: push repo |
| 6 | State which bounty is entered | Cannes Arc page | MANUAL: write "Best Smart Contracts on Arc with Advanced Stablecoin Logic" in submission |
| 7 | Built in Arc Studio; Studio project URL and Studio shown in demo | PRD 6.3 (Mumbai track reportedly "apps built in Arc Studio", third-party) | MANUAL: follow docs/tracks/arc-studio-prompt.md |
| 8 | Working campaign funding to claim on Arc testnet | PRD 6.3 | MANUAL: deploy (below), run the flow |
| 9 | Judging: quality of solution, depth of technical implementation, creativity | Arc winners blog | forge tests passing (incl. decimals guard) |
| 10 | Arc-native: USDC as gas | Docs | DONE: constructor requires ERC-20 decimals() == 6; Deploy defaults to official USDC; UX note above |
| 11 | CCTP/Gateway/Forwarder (named in track text) | Cannes Arc page | Doc path only (below), not built |

## Deploy and verify (exact commands)
Prereqs: testnet-only deployer key funded at https://faucet.circle.com (USDC is gas). Need ADMIN_ADDRESS, UPDATER_ADDRESS, FORWARDER_ADDRESS (Chainlink forwarder for Arc testnet from CRE docs, UNVERIFIED; any address works for a non-CRE demo).

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts && forge build && forge test
export ADMIN_ADDRESS=0x... UPDATER_ADDRESS=0x... FORWARDER_ADDRESS=0x...
export EXPECTED_WORKFLOW_OWNER=0x...   # CRE workflow owner; REQUIRED (receiver fails closed). Optional: EXPECTED_WORKFLOW_ID (bytes32), EXPECTED_WORKFLOW_NAME (bytes10)
# simulation-only alternative (mock forwarder passes no metadata): export INSECURE_SKIP_WORKFLOW_CHECK=true   # NEVER for production
# optional: TREASURY_ADDRESS CAMPAIGNER_FEE_BPS=25 CREATOR_FEE_BPS=25 (max 50 each) RETENTION_SECONDS HIGH_VALUE_THRESHOLD
export DEPLOYER_PRIVATE_KEY=0x...   # testnet only
forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY --broadcast
# verify (explorer assumed Blockscout-style, UNVERIFIED; fall back to the explorer UI)
forge verify-contract <ESCROW_ADDR> src/ClippoEscrow.sol:ClippoEscrow --chain-id 5042002 \
  --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" 0x3600000000000000000000000000000000000000 $TREASURY <DEPLOYER>)
```
One-shot from repo root, which also writes config:
```bash
node scripts/deploy-arc.mjs --deploy     # forge script --broadcast --verify, then writes env
node scripts/deploy-arc.mjs              # only (re)write env from the last broadcast log
node scripts/deploy-arc.mjs --dry        # print only
```
It upserts ESCROW_ADDRESS, ESCROW_DEPLOY_BLOCK, REFERRAL_ADDRESS, PROFILE_ADDRESS, REPORT_RECEIVER_ADDRESS, ARC_RPC_URL, ARC_CHAIN_ID in web/.env.local; sets `evm.receiverAddress` in cre/workflows/clippo-settlement/config.staging.json; replaces the placeholder RPC in cre/project.yaml. Deploy.s.sol reverts off chain 5042002 unless ALLOW_ANY_CHAIN=true.

## CCTP deposit path (doc only)
A campaigner holding USDC on another chain bridges to Arc with CCTP V2 (domain 26) or App Kit Bridge (https://docs.arc.io/app-kit/bridge.md), using the Forwarding Service (https://docs.arc.io/app-kit/tutorials/bridge/use-forwarding-service.md) to mint straight to their Arc address, then approves and calls `createCampaign`. A hook contract that calls createCampaign on mint is a later add-on.

## Unverified
Mumbai prize page text and weights; Studio login and web import UI; blockscout verifier path; faucet cap; Chainlink forwarder address on Arc; Circle USDC blacklisting could make claim/refund revert for a blocked address.
