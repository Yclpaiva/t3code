#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
wrapper="$script_dir/t3prod"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

cat > "$temp_dir/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'HOME=%s\n' "${T3CODE_HOME:-}"
printf 'RELAY=%s\n' "${T3CODE_RELAY_URL:-}"
printf 'ARGS=%s\n' "$*"
EOF
chmod +x "$temp_dir/node"

cat > "$temp_dir/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'SYSTEMCTL=%s\n' "$*"
EOF
chmod +x "$temp_dir/systemctl"

touch "$temp_dir/bin.mjs"

run_wrapper() {
  T3PROD_NODE="$temp_dir/node" \
    T3PROD_ENTRY="$temp_dir/bin.mjs" \
    T3PROD_SYSTEMCTL="$temp_dir/systemctl" \
    "$wrapper" "$@"
}

output="$(run_wrapper connect status)"
grep -Fq 'HOME=/home/yuri/.t3code-production' <<<"$output"
grep -Fq 'RELAY=https://relay.t3.codes' <<<"$output"
grep -Fq "ARGS=$temp_dir/bin.mjs connect status" <<<"$output"

output="$(run_wrapper service status)"
grep -Fq 'SYSTEMCTL=--user status t3code-prod.service --no-pager' <<<"$output"

if output="$(run_wrapper connect 2>&1)"; then
  echo 'expected bare connect command to be rejected' >&2
  exit 1
fi
grep -Fq 't3prod connect login' <<<"$output"
grep -Fq 't3prod connect link' <<<"$output"

if output="$(run_wrapper service update 2>&1)"; then
  echo 'expected service update to be rejected' >&2
  exit 1
fi
grep -Fq 'branch prod' <<<"$output"

echo 't3prod wrapper tests passed'
