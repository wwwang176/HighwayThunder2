#!/usr/bin/env bash
# Run several headless training processes side by side, one seed each.
#   bash training/run-many.sh <first-seed> <count> <generations>
first=${1:-1}; count=${2:-8}; gens=${3:-300}
cd "$(dirname "$0")/.."
for ((i = 0; i < count; i++)); do
  s=$((first + i))
  TRAIN_SEED=$s TRAIN_GENERATIONS=$gens npx vitest run --config training/vitest.config.ts training/headless.train.ts > "training/out/run-$s.txt" 2>&1 &
done
wait
