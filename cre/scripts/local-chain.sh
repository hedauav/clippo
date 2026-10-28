#!/usr/bin/env bash
# Deploys MockUSDC + ClippoEscrow + ClippoReportReceiver on a LOCAL anvil fork of Arc testnet and seeds campaigns 1..12
# (7 and 12 Approved PerView campaigns, matching the shared fixture's campaign ids).
# Prereq:  anvil --fork-url https://rpc.testnet.arc.network --port 8545 --chain-id 5042002   (fork keeps the real MockKeystoneForwarder)
# Usage:   bash scripts/local-chain.sh        -> writes scripts/.local-chain.env (addresses) and prints them
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS="$HERE/../../contracts"
RPC="${RPC_URL:-http://127.0.0.1:8545}"
# Well-known public anvil account #0 (TEST ONLY, no value on any real network).
PK="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
ME="$(cast wallet address --private-key "$PK")"
# Arc testnet MockKeystoneForwarder (simulation forwarder) from the CRE forwarder directory.
FORWARDER="${FORWARDER_ADDRESS:-0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1}"
# ALLOW_ANY_CHAIN=true below makes Deploy.s.sol default INSECURE_SKIP_WORKFLOW_CHECK=true (mock forwarder passes no workflow metadata).

cd "$CONTRACTS"
last_addr() { grep -oE "$1[^0-9a-fA-Fx]*0x[0-9a-fA-F]{40}" | tail -1 | grep -oE "0x[0-9a-fA-F]{40}"; }

OUT=$(forge script script/DeployMock.s.sol --rpc-url "$RPC" --private-key "$PK" --broadcast 2>&1)
USDC=$(echo "$OUT" | last_addr MockUSDC)
echo "MockUSDC $USDC"

OUT=$(ALLOW_ANY_CHAIN=true ADMIN_ADDRESS=$ME UPDATER_ADDRESS=$ME FORWARDER_ADDRESS=$FORWARDER USDC_ADDRESS=$USDC \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$PK" --broadcast 2>&1)
ESCROW=$(echo "$OUT" | last_addr ClippoEscrow)
RECEIVER=$(echo "$OUT" | last_addr ClippoReportReceiver)
echo "ClippoEscrow $ESCROW"; echo "ClippoReportReceiver $RECEIVER"

S="--rpc-url $RPC --private-key $PK"
cast send $USDC "mint(address,uint256)" $ME 1000000000 $S >/dev/null
cast send $USDC "approve(address,uint256)" $ESCROW 1000000000 $S >/dev/null
DEADLINE=$(( $(date +%s) + 30*86400 ))
# createCampaign(mode=0 PerView, rate=$10 per 1k views, pool, deadline, requireAdminApproval=false, uri)
for i in $(seq 1 12); do
  POOL=1000000            # $1 pool (cap demo) ...
  [ "$i" = "7" ] && POOL=500000000   # ... except campaign 7: $500
  cast send $ESCROW "createCampaign(uint8,uint256,uint256,uint64,bool,string)" 0 10000000 $POOL $DEADLINE false "ipfs://clippo-demo-$i" $S >/dev/null
done
cast send $ESCROW "approveCampaign(uint256)" 7 $S >/dev/null
cast send $ESCROW "approveCampaign(uint256)" 12 $S >/dev/null
echo "campaignCount $(cast call $ESCROW 'campaignCount()(uint256)' --rpc-url $RPC)"

cat > "$HERE/.local-chain.env" <<ENV
RPC_URL=$RPC
USDC=$USDC
ESCROW=$ESCROW
RECEIVER=$RECEIVER
FORWARDER=$FORWARDER
CRE_ETH_PRIVATE_KEY=$PK
ENV
echo "wrote $HERE/.local-chain.env"

# Point the staging workflow config at the freshly deployed receiver.
CFG="$HERE/../workflows/clippo-settlement/config.staging.json"
sed -i -E "s/(\"receiverAddress\": \")0x[0-9a-fA-F]{40}/\1$RECEIVER/" "$CFG"
echo "updated receiverAddress in $CFG"
