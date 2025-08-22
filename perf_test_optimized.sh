#!/bin/bash

echo "========================================="
echo "PERFORMANCE TEST - AFTER OPTIMIZATIONS"
echo "========================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: First query (cold cache)
echo -e "${YELLOW}Test 1: First Query (Cold Cache)${NC}"
START=$(date +%s%N)
primordyn query "ContextRetriever" --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "First query: ${GREEN}${ELAPSED}ms${NC}"

# Test 2: Same query (warm cache)
echo -e "\n${YELLOW}Test 2: Same Query (Warm Cache)${NC}"
START=$(date +%s%N)
primordyn query "ContextRetriever" --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "Cached query: ${GREEN}${ELAPSED}ms${NC}"

# Test 3: Different query
echo -e "\n${YELLOW}Test 3: Different Query${NC}"
START=$(date +%s%N)
primordyn query "Indexer" --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "New query: ${GREEN}${ELAPSED}ms${NC}"

# Test 4: Alias query
echo -e "\n${YELLOW}Test 4: Alias Query (database)${NC}"
START=$(date +%s%N)
primordyn query "database" --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "Alias query: ${GREEN}${ELAPSED}ms${NC}"

# Test 5: File path query
echo -e "\n${YELLOW}Test 5: File Path Query${NC}"
START=$(date +%s%N)
primordyn query "src/retriever/index.ts" --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "File path: ${GREEN}${ELAPSED}ms${NC}"

# Test 6: Rapid successive queries
echo -e "\n${YELLOW}Test 6: 10 Rapid Queries${NC}"
TOTAL=0
for i in {1..10}; do
    START=$(date +%s%N)
    primordyn query "test$i" --no-refresh --format json > /dev/null 2>&1
    END=$(date +%s%N)
    QUERY_TIME=$((($END - $START)/1000000))
    TOTAL=$(($TOTAL + $QUERY_TIME))
    echo -n "."
done
AVG=$(($TOTAL / 10))
echo -e "\nAverage: ${GREEN}${AVG}ms${NC}"

# Test 7: Large result query
echo -e "\n${YELLOW}Test 7: Large Token Query${NC}"
START=$(date +%s%N)
primordyn query "function" --tokens 32000 --no-refresh --format json > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$((($END - $START)/1000000))
echo -e "Large query: ${GREEN}${ELAPSED}ms${NC}"

echo ""
echo "========================================="
echo "COMPLETE"
echo "========================================="