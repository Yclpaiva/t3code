#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-character-git-sha>" >&2
  exit 2
fi

sha="$1"
deploy_root="${T3CODE_DEPLOY_ROOT:-/opt/t3code}"
repository_url="${T3CODE_REPOSITORY_URL:-https://github.com/Yclpaiva/t3code.git}"
deploy_branch="${T3CODE_DEPLOY_BRANCH:-prod}"
service_name="${T3CODE_SERVICE_NAME:-t3code-prod.service}"
health_url="${T3CODE_HEALTH_URL:-http://127.0.0.1:3774/}"
repo_dir="$deploy_root/repository"
releases_dir="$deploy_root/releases"
release_dir="$releases_dir/$sha"
current_link="$deploy_root/current"

mkdir -p "$deploy_root" "$releases_dir"
exec 9>"$deploy_root/deploy.lock"
flock 9

if [[ ! -d "$repo_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$repository_url" "$repo_dir"
else
  git -C "$repo_dir" remote set-url origin "$repository_url"
fi

git -C "$repo_dir" fetch --prune origin "$deploy_branch"
remote_sha="$(git -C "$repo_dir" rev-parse FETCH_HEAD)"
if [[ "$remote_sha" != "$sha" ]]; then
  echo "refusing deploy: origin/$deploy_branch is $remote_sha, requested $sha" >&2
  exit 1
fi

if [[ ! -f "$release_dir/.t3code-build-complete" ]]; then
  if [[ -e "$release_dir" ]]; then
    git -C "$repo_dir" worktree remove --force "$release_dir" 2>/dev/null || rm -rf "$release_dir"
  fi

  git -C "$repo_dir" worktree add --force --detach "$release_dir" "$sha"
  (
    cd "$release_dir"
    export PATH="$HOME/.vite-plus/bin:$PATH"
    export T3CODE_RELAY_URL="https://relay.t3.codes"
    export T3CODE_CLERK_PUBLISHABLE_KEY="pk_live_Y2xlcmsudDMuY29kZXMk"
    export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID="hzxSgY2cH10sDU2r"
    export T3CODE_HOSTED_APP_URL="https://t3code.yclpaiva.dev"
    vp install --frozen-lockfile
    vp run --filter t3 build
    test -f apps/server/dist/bin.mjs
    test -f apps/server/dist/client/index.html
    touch .t3code-build-complete
  )
fi

previous_release="$(readlink -f "$current_link" 2>/dev/null || true)"
next_link="$deploy_root/.current-$sha"
ln -sfn "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"

if ! systemctl --user restart "$service_name"; then
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$next_link"
    mv -Tf "$next_link" "$current_link"
    systemctl --user restart "$service_name" || true
  fi
  exit 1
fi

if ! curl --fail --silent --show-error \
  --connect-timeout 2 --max-time 10 \
  --retry 15 --retry-delay 2 --retry-connrefused \
  "$health_url" >/dev/null; then
  echo "health check failed after deploying $sha; rolling back" >&2
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$next_link"
    mv -Tf "$next_link" "$current_link"
    systemctl --user restart "$service_name" || true
  fi
  exit 1
fi

printf '%s\n' "$sha" >"$deploy_root/deployed-sha"

current_release="$(readlink -f "$current_link")"
mapfile -t old_releases < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d' ' -f2-)
for old_release in "${old_releases[@]}"; do
  [[ "$old_release" == "$current_release" ]] && continue
  git -C "$repo_dir" worktree remove --force "$old_release" 2>/dev/null || rm -rf "$old_release"
done
git -C "$repo_dir" worktree prune

echo "deployed $sha"
