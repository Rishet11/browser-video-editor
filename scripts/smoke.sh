#!/usr/bin/env bash
# Manual smoke test for the Phase 7 REST + Prisma routes.
# Requires a live DB, seeded via `npm run db:seed`, and the dev server running.
#
# Usage: BASE_URL=http://localhost:3000 COMP_ID=seed-edl ./scripts/smoke.sh
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
COMP_ID="${COMP_ID:-seed-edl}"

echo "== GET seeded composition =="
curl -s -o /dev/null -w "status: %{http_code}\n" "$BASE_URL/api/editor/$COMP_ID"
curl -s "$BASE_URL/api/editor/$COMP_ID" | head -c 500
echo

# Pick the first element id off the seeded composition to exercise PATCH/split.
ELEMENT_ID=$(curl -s "$BASE_URL/api/editor/$COMP_ID" | ./node_modules/.bin/tsx -e "
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    const edl = JSON.parse(input);
    console.log(edl.layers[0].elements[0].id);
  });
" 2>/dev/null)
ELEMENT_ID="${ELEMENT_ID:-bg-image-1}"

echo "== PATCH element with duration below MIN_DURATION (expect 400) =="
curl -s -o /dev/null -w "status: %{http_code}\n" \
  -X PATCH "$BASE_URL/api/editor/$COMP_ID/element/$ELEMENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"duration":0.2}'

echo "== PATCH element with valid duration (expect 200) =="
curl -s -o /dev/null -w "status: %{http_code}\n" \
  -X PATCH "$BASE_URL/api/editor/$COMP_ID/element/$ELEMENT_ID" \
  -H "Content-Type: application/json" \
  -d '{"duration":3}'

echo "== POST valid split (expect 200) =="
curl -s -o /dev/null -w "status: %{http_code}\n" \
  -X POST "$BASE_URL/api/editor/$COMP_ID/split" \
  -H "Content-Type: application/json" \
  -d "{\"elementId\":\"$ELEMENT_ID\",\"atTime\":1}"

echo "== POST out-of-range split (expect 400) =="
curl -s -o /dev/null -w "status: %{http_code}\n" \
  -X POST "$BASE_URL/api/editor/$COMP_ID/split" \
  -H "Content-Type: application/json" \
  -d "{\"elementId\":\"$ELEMENT_ID\",\"atTime\":999}"
