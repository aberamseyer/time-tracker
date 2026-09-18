# Deploy

CI (`.github/workflows/deploy.yml`) builds and tests in the cloud, uploads the
compiled `dist/` as an artifact, then a self-hosted runner downloads it,
rsyncs the tree (including `dist/`) to the VPS over WireGuard, installs the
LTS node, rebuilds native deps, and restarts the systemd unit. The service
runs `dist/src/server.js`; no build happens on the VPS. One-time VPS setup
below.

## Node version

`.nvmrc` pins `lts/*`; `package.json` `engines` requires node >=24. The deploy runs
`nvm install` (honoring `.nvmrc`) and re-points `~/bin/tt-node` at that node every
run, so the systemd unit always launches the same node the native deps were built
against. Upgrading LTS needs no server edits.

## One-time VPS setup

1. Clone, bootstrap-build once, and seed:
   ```
   git clone git@github.com:aberamseyer/time-tracker.git ~/time-tracker
   cd ~/time-tracker
   nvm install                      # installs LTS per .nvmrc
   mkdir -p ~/bin
   ln -sfn "$(readlink -f "$(nvm which current)")" ~/bin/tt-node
   npm ci                           # full install incl. devDeps, for this one-time build
   npm run build                    # produce dist/ (recurring deploys ship dist/ from CI instead)
   cp .env.example .env             # or create it; set TT_USERNAME/PASSWORD, PORT, session secret
   npm run seed                     # create the login user
   ```
   Recurring deploys run `npm ci --omit=dev` on the VPS (already in the
   workflow) and never build there — CI ships the compiled `dist/`. The full
   `npm ci && npm run build` above is only for this first-time bootstrap.

2. Install the service (edit placeholders first):
   ```
   sudo cp deploy/time-tracker.service /etc/systemd/system/time-tracker.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now time-tracker
   systemctl status time-tracker
   ```

3. Passwordless restart for the deploy user (`sudo visudo -f /etc/sudoers.d/time-tracker`):
   ```
   DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart time-tracker
   ```
   Check `which systemctl` — some distros use `/bin/systemctl`.

## Runner + secrets

- Register the self-hosted runner on the laptop (repo Settings -> Actions -> Runners).
- The laptop must already `ssh $SSH_USER@$SSH_HOST` over WireGuard with a key.
- Repo secrets: `SSH_HOST`, `SSH_USER`, `DEPLOY_PATH`, `SERVICE_NAME`, `HEALTH_URL`,
  and `SSH_PORT` if not 22.

## Never

Do not add `pull_request`/`pull_request_target` triggers to the `self-hosted`
deploy job — fork PR code would run on the runner.
