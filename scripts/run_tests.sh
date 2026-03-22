#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  PassportSnap — Master Test Runner
# ═══════════════════════════════════════════════════════════════
#
#  Usage:
#    ./run_tests.sh              # Run all tests
#    ./run_tests.sh unit         # Android instrumentation tests only
#    ./run_tests.sh verify       # Output photo verification only
#    ./run_tests.sh constants    # Spec constant checks only
#    ./run_tests.sh perf         # Performance benchmarks only
#    ./run_tests.sh pull         # Pull photos from device + verify
#    ./run_tests.sh full         # Full pipeline: build → install → pull → verify
#
# ═══════════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_PHOTOS="$SCRIPT_DIR/test_photos"
REPORT_DIR="$SCRIPT_DIR/reports"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

#mkdir -p "$TEST_PHOTOS" "$REPORT_DIR"

timestamp=$(date +%Y%m%d_%H%M%S)

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  PassportSnap Test Runner — $(date)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"

# ── Helper functions ──
check_device() {
    if ! adb devices | grep -q "device$"; then
        echo -e "${RED}No Android device connected. Connect device or start emulator.${NC}"
        return 1
    fi
    echo -e "${GREEN}✓ Device connected: $(adb devices | grep 'device$' | head -1)${NC}"
    return 0
}

check_python() {
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}python3 not found. Install Python 3.${NC}"
        return 1
    fi
    python3 -c "import PIL, numpy" 2>/dev/null || {
        echo -e "${YELLOW}Installing Python dependencies...${NC}"
        pip3 install Pillow numpy --quiet
    }
    return 0
}

# ── Test: Android Instrumentation (on-device) ──
run_unit_tests() {
    echo -e "\n${CYAN}▶ ANDROID INSTRUMENTATION TESTS${NC}"
    check_device || return 1

    cd "$PROJECT_DIR"
    echo "Building and running instrumented tests..."
    ./gradlew connectedAndroidTest 2>&1 | tee "$REPORT_DIR/unit_test_${timestamp}.log"

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ All instrumentation tests passed${NC}"
    else
        echo -e "${RED}✗ Some instrumentation tests failed. See log: $REPORT_DIR/unit_test_${timestamp}.log${NC}"
    fi
}

# ── Test: Pull photos and verify ──
pull_and_verify() {
    echo -e "\n${CYAN}▶ PULLING PHOTOS FROM DEVICE${NC}"
    check_device || return 1

    echo "Pulling from /sdcard/DCIM/..."
    adb pull /sdcard/DCIM/ "$TEST_PHOTOS/" 2>/dev/null || true
    adb pull /sdcard/Pictures/ "$TEST_PHOTOS/" 2>/dev/null || true

    photo_count=$(find "$TEST_PHOTOS" -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" 2>/dev/null | wc -l)
    echo -e "Found ${GREEN}$photo_count${NC} photos"

    run_verify_tests
}

# ── Test: Output verification (Python) ──
run_verify_tests() {
    echo -e "\n${CYAN}▶ OUTPUT VERIFICATION TESTS${NC}"
    check_python || return 1

    local test_type="${1:-all}"
    python3 "$SCRIPT_DIR/scripts/passportsnap_verify.py" \
        --dir "$TEST_PHOTOS" \
        --test "$test_type" \
        --report "$REPORT_DIR/verify_${timestamp}.json"
}

# ── Test: Constants only (no device needed) ──
run_constant_tests() {
    echo -e "\n${CYAN}▶ SPEC CONSTANT VERIFICATION${NC}"
    check_python || return 1

    python3 "$SCRIPT_DIR/scripts/passportsnap_verify.py" \
        --test constants \
        --report "$REPORT_DIR/constants_${timestamp}.json"
}

# ── Test: Performance benchmarks ──
run_perf_tests() {
    echo -e "\n${CYAN}▶ PERFORMANCE BENCHMARKS${NC}"
    check_python || return 1

    python3 "$SCRIPT_DIR/scripts/passportsnap_verify.py" \
        --test perf \
        --report "$REPORT_DIR/perf_${timestamp}.json"
}

# ── Full pipeline ──
run_full_pipeline() {
    echo -e "\n${CYAN}▶ FULL TEST PIPELINE${NC}"
    check_device || return 1
    check_python || return 1

    echo -e "\n${YELLOW}Step 1/4: Spec constant checks${NC}"
    run_constant_tests

    echo -e "\n${YELLOW}Step 2/4: Performance benchmarks${NC}"
    run_perf_tests

    echo -e "\n${YELLOW}Step 3/4: Android instrumentation tests${NC}"
    run_unit_tests

    echo -e "\n${YELLOW}Step 4/4: Pull photos + verification${NC}"
    pull_and_verify

    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Reports saved in: $REPORT_DIR/${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
}

# ── Main dispatch ──
case "${1:-all}" in
    unit)      run_unit_tests ;;
    verify)    run_verify_tests "${2:-all}" ;;
    constants) run_constant_tests ;;
    perf)      run_perf_tests ;;
    pull)      pull_and_verify ;;
    full)      run_full_pipeline ;;
    all)
        run_constant_tests
        run_perf_tests
        if check_device 2>/dev/null; then
            pull_and_verify
        else
            echo -e "${YELLOW}No device — skipping photo verification. Run with photos:${NC}"
            echo "  ./run_tests.sh pull"
        fi
        ;;
    *)
        echo "Usage: $0 {unit|verify|constants|perf|pull|full|all}"
        exit 1
        ;;
esac
