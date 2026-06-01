#!/usr/bin/env bash
#
# Sylva cluster health check — run from ~/sylva-core
# Detects bootstrap vs management state and reports failures.
#
# Usage: bash check-cluster-health.sh [bootstrap|management|auto]
# Default: auto (detect which cluster to check)

set -euo pipefail

SYLVA_DIR="${SYLVA_DIR:-$HOME/sylva-core}"
MGMT_KUBECONFIG="${SYLVA_DIR}/management-cluster-kubeconfig"
NAMESPACE="sylva-system"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }

section() { echo -e "\n${YELLOW}=== $* ===${NC}"; }

detect_mode() {
    local mode="${1:-auto}"

    if [[ "$mode" != "auto" ]]; then
        echo "$mode"
        return
    fi

    if kind get clusters 2>/dev/null | grep -q "^sylva$"; then
        if [[ -f "$MGMT_KUBECONFIG" ]] && kubectl --kubeconfig "$MGMT_KUBECONFIG" get nodes &>/dev/null 2>&1; then
            echo "both"
        else
            echo "bootstrap"
        fi
    elif [[ -f "$MGMT_KUBECONFIG" ]] && kubectl --kubeconfig "$MGMT_KUBECONFIG" get nodes &>/dev/null 2>&1; then
        echo "management"
    else
        echo "none"
    fi
}

check_kustomizations() {
    local kc_args=("$@")
    local failing

    failing=$(kubectl "${kc_args[@]}" get kustomizations -n "$NAMESPACE" --no-header 2>/dev/null \
        | awk '$2 != "True"' || true)

    if [[ -z "$failing" ]]; then
        ok "All kustomizations ready"
        return 0
    else
        fail "Failing kustomizations:"
        echo "$failing" | while read -r line; do
            echo "  $line"
        done
        return 1
    fi
}

check_helmreleases() {
    local kc_args=("$@")
    local failing

    failing=$(kubectl "${kc_args[@]}" get helmreleases.helm.toolkit.fluxcd.io -n "$NAMESPACE" --no-header 2>/dev/null \
        | awk '$2 != "True"' || true)

    if [[ -z "$failing" ]]; then
        ok "All HelmReleases ready"
        return 0
    else
        fail "Failing HelmReleases:"
        echo "$failing" | while read -r line; do
            echo "  $line"
        done
        return 1
    fi
}

check_pods() {
    local kc_args=("$@")
    local failing

    failing=$(kubectl "${kc_args[@]}" get pods -A --no-headers 2>/dev/null \
        | grep -v -E "Running|Completed|Succeeded" || true)

    if [[ -z "$failing" ]]; then
        ok "All pods healthy"
        return 0
    else
        warn "Non-running pods:"
        echo "$failing" | head -20 | while read -r line; do
            echo "  $line"
        done
        return 1
    fi
}

check_scc_events() {
    local kc_args=("$@")
    local scc_events

    scc_events=$(kubectl "${kc_args[@]}" get events -A --field-selector reason=FailedCreate --no-headers 2>/dev/null \
        | grep -i "scc\|security\|forbidden" || true)

    if [[ -z "$scc_events" ]]; then
        ok "No SCC-related failures"
    else
        fail "SCC violations detected:"
        echo "$scc_events" | tail -10 | while read -r line; do
            echo "  $line"
        done
    fi
}

check_capi_objects() {
    local kc_args=("$@")

    section "CAPI Objects"
    for kind in cluster machine bmh openshiftassistedcontrolplane; do
        local out
        out=$(kubectl "${kc_args[@]}" get "$kind" -n "$NAMESPACE" --no-headers 2>/dev/null || true)
        if [[ -n "$out" ]]; then
            echo "  $kind:"
            echo "$out" | while read -r line; do echo "    $line"; done
        fi
    done
}

check_pivot_status() {
    local kc_args=("$@")
    local pivot_job

    pivot_job=$(kubectl "${kc_args[@]}" get job pivot -n "$NAMESPACE" --no-headers 2>/dev/null || true)
    if [[ -z "$pivot_job" ]]; then
        warn "No pivot job found"
    elif echo "$pivot_job" | grep -q "1/1"; then
        ok "Pivot job complete"
    else
        fail "Pivot job not complete: $pivot_job"
    fi
}

check_cluster() {
    local label="$1"
    shift
    local kc_args=("$@")

    section "$label — Nodes"
    kubectl "${kc_args[@]}" get nodes 2>/dev/null || fail "Cannot reach cluster"

    section "$label — Kustomizations"
    check_kustomizations "${kc_args[@]}"

    section "$label — HelmReleases"
    check_helmreleases "${kc_args[@]}"

    section "$label — Pods"
    check_pods "${kc_args[@]}"

    section "$label — SCC Events"
    check_scc_events "${kc_args[@]}"
}

# --- Main ---
MODE=$(detect_mode "${1:-auto}")

echo "Detected mode: $MODE"
echo "Sylva dir: $SYLVA_DIR"

case "$MODE" in
    bootstrap|both)
        check_cluster "Bootstrap (KIND)" --context "kind-sylva"
        check_pivot_status --context "kind-sylva"
        check_capi_objects --context "kind-sylva"
        ;;&
    management|both)
        check_cluster "Management (OKD)" --kubeconfig "$MGMT_KUBECONFIG"
        check_capi_objects --kubeconfig "$MGMT_KUBECONFIG"

        section "Management — sylva-units-status"
        kubectl --kubeconfig "$MGMT_KUBECONFIG" get kustomization sylva-units-status -n "$NAMESPACE" 2>/dev/null || warn "sylva-units-status not found"
        ;;
    none)
        fail "No clusters detected. Need a fresh deploy."
        ;;
esac

echo ""
echo "Health check complete."
