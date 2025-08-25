#!/bin/bash

# Comprehensive Performance Test for Primordyn
# Tests indexing, querying, and various features

echo "================================================"
echo "PRIMORDYN COMPREHENSIVE PERFORMANCE TEST"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Start with a clean slate
echo -e "${BLUE}[SETUP]${NC} Clearing existing index..."
primordyn clear --force > /dev/null 2>&1

echo ""
echo -e "${YELLOW}=== TEST 1: Initial Indexing Performance ===${NC}"
echo "Testing first-time indexing speed..."
START_TIME=$(date +%s%N)
INDEX_OUTPUT=$(primordyn index 2>&1)
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "$INDEX_OUTPUT"
echo -e "${GREEN}Initial indexing completed in: ${ELAPSED}ms${NC}"

# Get stats
echo ""
echo -e "${YELLOW}=== TEST 2: Project Statistics ===${NC}"
primordyn stats

echo ""
echo -e "${YELLOW}=== TEST 3: Incremental Indexing (No Changes) ===${NC}"
echo "Testing re-index with no changes (should be fast)..."
START_TIME=$(date +%s%N)
primordyn index 2>&1 | grep -E "(No changes|files changed|Already up-to-date)"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}Incremental index (no changes) completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 4: Basic Symbol Search ===${NC}"
echo "Testing exact symbol search..."
START_TIME=$(date +%s%N)
primordyn query "ContextRetriever" --no-refresh --format json | jq -r '.symbols[0].name' 2>/dev/null || echo "No results"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}Symbol search completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 5: Fuzzy Search Performance ===${NC}"
echo "Testing fuzzy search with typo..."
START_TIME=$(date +%s%N)
primordyn query "ContxtRetriver" --no-refresh --format json | jq -r '.symbols[:3] | .[].name' 2>/dev/null || echo "No results"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}Fuzzy search completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 6: File Path Search ===${NC}"
echo "Testing file path search..."
START_TIME=$(date +%s%N)
primordyn query "src/retriever/index.ts" --no-refresh --format json | jq -r '.files[0].relativePath' 2>/dev/null || echo "No results"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}File path search completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 7: Alias Expansion Performance ===${NC}"
echo "Testing database alias..."
START_TIME=$(date +%s%N)
RESULT_COUNT=$(primordyn query "database" --no-refresh --format json | jq '.symbols | length' 2>/dev/null || echo "0")
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "Found $RESULT_COUNT symbols"
echo -e "${GREEN}Alias query completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 8: Large Token Query ===${NC}"
echo "Testing query with large token limit..."
START_TIME=$(date +%s%N)
TOKEN_COUNT=$(primordyn query "index" --tokens 32000 --no-refresh --format json | jq '.totalTokens' 2>/dev/null || echo "0")
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "Retrieved $TOKEN_COUNT tokens"
echo -e "${GREEN}Large token query completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 9: Multi-word Search ===${NC}"
echo "Testing multi-word search..."
START_TIME=$(date +%s%N)
primordyn query "async function" --no-refresh --format json | jq -r '.symbols[:3] | .[].name' 2>/dev/null || echo "No results"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}Multi-word search completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 10: Language Filter ===${NC}"
echo "Testing TypeScript-only search..."
START_TIME=$(date +%s%N)
TS_COUNT=$(primordyn query "function" --languages ts --no-refresh --format json | jq '.symbols | length' 2>/dev/null || echo "0")
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "Found $TS_COUNT TypeScript symbols"
echo -e "${GREEN}Language filter query completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 11: Symbol Type Filter ===${NC}"
echo "Testing class-only search..."
START_TIME=$(date +%s%N)
CLASS_COUNT=$(primordyn query "." --type class --no-refresh --format json | jq '.symbols | length' 2>/dev/null || echo "0")
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "Found $CLASS_COUNT classes"
echo -e "${GREEN}Symbol type filter completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 12: Complex Alias Creation ===${NC}"
echo "Adding complex project-specific alias..."
primordyn alias add "testing" "test OR spec OR mock OR jest OR describe OR it OR expect OR assert"
START_TIME=$(date +%s%N)
TEST_COUNT=$(primordyn query "testing" --no-refresh --format json | jq '.symbols | length' 2>/dev/null || echo "0")
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo "Found $TEST_COUNT test-related symbols"
echo -e "${GREEN}Complex alias query completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 13: Special Character Handling ===${NC}"
echo "Testing decorator pattern search..."
START_TIME=$(date +%s%N)
primordyn query "@" --no-refresh --format json | jq -r '.symbols[:3] | .[].name' 2>/dev/null || echo "No @ symbols found"
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
echo -e "${GREEN}Special character search completed in: ${ELAPSED}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 14: Memory Usage Check ===${NC}"
echo "Checking database size..."
DB_SIZE=$(du -h .primordyn/context.db 2>/dev/null | cut -f1)
echo "Database size: $DB_SIZE"

echo ""
echo -e "${YELLOW}=== TEST 15: Stress Test - Rapid Queries ===${NC}"
echo "Running 10 rapid queries..."
TOTAL_TIME=0
for i in {1..10}; do
    START_TIME=$(date +%s%N)
    primordyn query "query$i" --no-refresh --format json > /dev/null 2>&1
    END_TIME=$(date +%s%N)
    QUERY_TIME=$((($END_TIME - $START_TIME)/1000000))
    TOTAL_TIME=$(($TOTAL_TIME + $QUERY_TIME))
    echo -n "."
done
echo ""
AVG_TIME=$(($TOTAL_TIME / 10))
echo -e "${GREEN}Average query time: ${AVG_TIME}ms${NC}"

echo ""
echo -e "${YELLOW}=== TEST 16: Auto-refresh Performance ===${NC}"
echo "Testing query with auto-refresh enabled..."
touch src/test_marker.tmp
START_TIME=$(date +%s%N)
primordyn query "index" --format json 2>&1 | grep -E "(Refreshing|files changed|No changes)" || true
END_TIME=$(date +%s%N)
ELAPSED=$((($END_TIME - $START_TIME)/1000000))
rm -f src/test_marker.tmp
echo -e "${GREEN}Auto-refresh query completed in: ${ELAPSED}ms${NC}"

echo ""
echo "================================================"
echo -e "${GREEN}PERFORMANCE TEST COMPLETE${NC}"
echo "================================================"