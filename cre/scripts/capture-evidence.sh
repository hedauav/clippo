#!/usr/bin/env bash
# Reproduces docs/tracks/cre-simulation-output.txt: fresh anvil fork of Arc testnet -> deploy -> mock backend ->
# workflow-path emulation for: fixture, replay, +views, empty, stale, large batch.  (Use `cre workflow simulate` for the real thing: see docs/tracks/CRE.md)
# Prereq: foundry + node 22+ on PATH. Run from cre/:  bash scripts/capture-evidence.sh | tee ../docs/tracks/cre-simulation-output.txt
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "${BASH_SOURCE[0]}")/.."
pkill -f "anvil --fork-url" 2>/dev/null; sleep 1
anvil --fork-url "${ARC_RPC:-https://rpc.testnet.arc.network}" --port 8545 --chain-id 5042002 >/dev/null 2>&1 &
ANVIL=$!; trap 'kill $ANVIL $MOCK 2>/dev/null' EXIT
until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 1; done
cat <<'NOTE'
# NOTE: this is NOT `cre workflow simulate` output (that command requires `cre login`, not possible in the build environment).
# It runs the workflow's own fetch/normalise/staleness/chunk/ABI-encode code (snapshot.ts) and delivers each report through the real
# Arc-testnet MockKeystoneForwarder on a local anvil fork, i.e. the same on-chain call the simulator makes with --broadcast.
NOTE
echo "# chain: anvil fork of Arc testnet (chainId 5042002), block $(cast block-number --rpc-url http://127.0.0.1:8545)"
echo "# forwarder (Arc testnet MockKeystoneForwarder) code bytes: $(cast code 0x6E9EE680ef59ef64Aa8C7371279c27E496b5eDc1 --rpc-url http://127.0.0.1:8545 | wc -c)"
bash scripts/local-chain.sh 2>&1 | grep -v "^$"
run() { # mode [extra args]
  node scripts/mock-backend.mjs --mode "$1" "${@:2}" >/dev/null 2>&1 & MOCK=$!; sleep 1
  echo; echo "=== scenario: $1 ${*:2} ==="
  node --experimental-strip-types --no-warnings scripts/emulate-delivery.mts 2>&1; echo "exit=$?"
  kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null
}
run fixture      # first delivery: credits new views, campaign 12 capped by pool
run fixture      # replay: identical report -> escrow idempotent, 0 credited
run bump         # next day: +100 views on first row -> only the delta is credited
run empty        # empty feed -> no-op
run stale        # stale day -> rejected
run large --large-rows 60   # 60 rows -> 3 reports of 25
