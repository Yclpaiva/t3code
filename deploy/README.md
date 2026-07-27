# Production deployment

Pushes to `prod` run focused server checks, build the web/server bundle, and then deploy the exact
commit to the VPS over SSH. The VPS keeps immutable worktree releases under `/opt/t3code/releases`,
atomically switches `/opt/t3code/current`, restarts the user systemd service, and rolls back when
the local health check fails.

Required GitHub Actions secrets:

- `DEPLOY_HOST`: VPS hostname or IP address.
- `DEPLOY_USER`: unprivileged VPS account that owns `/opt/t3code`.
- `DEPLOY_SSH_KEY`: private key dedicated to CI deployment.
- `DEPLOY_HOST_KEYS`: pinned `known_hosts` line for the VPS.

Runtime state is persisted in `/home/yuri/.t3code-production`; source releases are disposable.
