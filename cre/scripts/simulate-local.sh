#!/usr/bin/env bash
# REAL CRE simulation against the local anvil fork + mock backend. Requires: `cre login` done (account), cre CLI, bun, foundry, node.
# Run from cre/ :  bash scripts/simulate-local.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
anvil --fork-url "${ARC_RPC:-https://rpc.testnet.arc.network}" --port 8545 --chain-id 5042002 >/dev/null 2>&1 &
ANVIL=$!; trap 'kill $ANVIL $MOCK 2>/dev/null || true' EXIT
until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 1; done
bash scripts/local-chain.sh                 # deploys MockUSDC/escrow/receiver, patches config.staging.json receiverAddress
set -a; source scripts/.local-chain.env; set +a   # exports CRE_ETH_PRIVATE_KEY (public anvil key)
node scripts/mock-backend.mjs & MOCK=$!; sleep 1
echo "--- cron trigger (index 0), --broadcast ---"
cre workflow simulate ./workflows/clippo-settlement --target staging-settings --non-interactive --trigger-index 0 --broadcast
echo "--- HTTP trigger (index 1), replay of the same day: escrow credits 0 ---"
cre workflow simulate ./workflows/clippo-settlement --target staging-settings --non-interactive --trigger-index 1 --http-payload '{}' --broadcast
echo "--- escrow state ---"
for c in "7 0x1111111111111111111111111111111111111111" "7 0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" "12 0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD"; do
  set -- $c; echo "campaign $1 creator $2 reportedViews=$(cast call $ESCROW 'reportedViews(uint256,address)(uint256)' $1 $2 --rpc-url $RPC_URL) credited=$(cast call $ESCROW 'credited(uint256,address)(uint256)' $1 $2 --rpc-url $RPC_URL)"
done
