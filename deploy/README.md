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
t3prod connect link
systemctl --user restart t3code-prod.service
```

Do not run the combined `npx t3 connect` onboarding or `npx t3 service update` for this deployment.
The systemd unit PATH must keep `~/.opencode/bin` and `~/.local/bin` so production providers stay on PATH after CI recopies the unit.
Update the fork from upstream, push `prod`, and let the production workflow perform the rollout.
