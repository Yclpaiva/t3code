# Production deployment

Pushes to `prod` run focused server checks, build the web/server bundle, and then deploy the exact
commit to the VPS over SSH. The VPS keeps immutable worktree releases under `/opt/t3code/releases`,
atomically switches `/opt/t3code/current`, restarts `t3code-prod.service`, and rolls back when the
local health check fails. The production unit has a distinct name because T3 Code's built-in service
installer owns `t3code.service` and may replace it during T3 Connect setup or self-updates.

Required GitHub Actions secrets:

- `DEPLOY_HOST`: VPS hostname or IP address.
- `DEPLOY_USER`: unprivileged VPS account that owns `/opt/t3code`.
- `DEPLOY_SSH_KEY`: private key dedicated to CI deployment.
- `DEPLOY_HOST_KEYS`: pinned `known_hosts` line for the VPS.

Runtime state is persisted in `/home/yuri/.t3code-production`; source releases are disposable.

## Production CLI

Use `t3prod` instead of `npx t3` when managing the deployed environment. The wrapper always targets
the production T3 home and blocks built-in service operations, because those operations own
`t3code.service` while this deployment is intentionally managed as `t3code-prod.service`.

```bash
t3prod connect status
t3prod connect login --headless
t3prod connect environments --json
t3prod connect link
systemctl --user restart t3code-prod.service
```

`connect environments` lists the labels, ids, and relay endpoints linked to the
authenticated account. It does not print OAuth credentials or environment access tokens.
Run `connect login --headless` again when the stored Clerk credential can no longer refresh.

Do not run the combined `npx t3 connect` onboarding or `npx t3 service update` for this deployment.
The systemd unit PATH must keep `~/.opencode/bin` and `~/.local/bin` so production providers stay on PATH after CI recopies the unit.
`ExecStart` runs through `~/.local/share/agent-kit/src/scripts/with-env` so OpenCode inherits the same API keys as an interactive shell (`OPENCODE_API_KEY` and the rest of `env.d`).
The production web bundle is hosted at `https://t3code.yclpaiva.dev` and uses that origin for T3 Connect sign-in and discovery. The Clerk OAuth application must allow `https://t3code.yclpaiva.dev/connect/callback` in addition to the loopback callback used by local CLI login.
Update the fork from upstream, push `prod`, and let the production workflow perform the rollout.
