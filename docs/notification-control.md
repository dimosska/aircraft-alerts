# Toggle aircraft notifications from Apple Shortcuts

The control path does not require inbound access to n8n or the predictor:

1. An iPhone Shortcut publishes `toggle`, `on`, or `off` to a separate secret topic on `https://ntfy.sh`.
2. A second n8n schedule calls the private predictor endpoint `/control/sync` every 15 seconds, all day.
3. The predictor polls cached ntfy messages over outbound HTTPS, validates their age and command, and atomically updates the notification state in Redis.
4. The predictor sends the resulting state to both configured iPhone notification topics.

The Redis state and ntfy cursor survive container restarts. Each ntfy message ID can be applied only once, so replaying a cached `toggle` command cannot accidentally reverse the state again. Commands older than `NTFY_CONTROL_MAX_COMMAND_AGE_SECONDS` are ignored.

## Server setup

Generate a third independent topic on the server:

```bash
openssl rand -hex 24
```

Add the generated value only to the server's untracked `.env`:

```dotenv
NTFY_CONTROL_ENABLED=true
NTFY_CONTROL_TOPIC=<48-character-random-value>
NTFY_CONTROL_INITIAL_REPLAY_SECONDS=60
NTFY_CONTROL_MAX_COMMAND_AGE_SECONDS=120
```

Do not reuse either iPhone notification topic and do not subscribe the ntfy iOS app to the control topic. Anyone who knows the control topic can change the state.

Rebuild the predictor and recreate the services:

```bash
docker compose build predictor
docker compose up -d --force-recreate predictor n8n
```

Import `n8n/workflows/notification-control.json`, inspect it, and publish it. It is separate from the existing aircraft workflow, so the already published aircraft workflow does not need to be replaced.

The two workflows run independently:

- aircraft polling every 15 seconds from 10:00 through 19:59;
- ntfy control synchronization every 15 seconds, 24 hours a day.

## Create the toggle Shortcut on each iPhone

The same Shortcut can be installed on both phones.

1. Open **Shortcuts** and create a new shortcut named **Toggle aircraft alerts**.
2. Add a **URL** action containing `https://ntfy.sh/<NTFY_CONTROL_TOPIC>`.
3. Add **Get Contents of URL**.
4. Set its method to **POST**.
5. Add the request header `X-Message` with value `toggle`.
6. Optionally add **Show Notification** with text `Aircraft alert command sent`.
7. Add the shortcut to the Home Screen, Lock Screen widget, or Action Button as desired.

The Shortcut's immediate HTTP result only confirms that ntfy accepted the command. Within about 15 seconds, both phones receive a separate Ukrainian notification confirming whether aircraft alerts are actually enabled or disabled.

For deterministic controls, duplicate the Shortcut and replace `toggle` with `on` or `off`. This avoids an accidental double-tap reversing the desired state.

Treat a Shortcut containing the topic URL as a secret. Do not publish it or share an iCloud Shortcut link publicly.

## Test and inspect state

From the server, publish a test command without printing the topic:

```bash
set -a
. ./.env
set +a
curl --fail-with-body --silent --show-error \
  --output /dev/null --write-out 'ntfy HTTP %{http_code}\n' \
  -H 'X-Message: toggle' \
  "${NTFY_BASE_URL}/${NTFY_CONTROL_TOPIC}"
unset NTFY_CONTROL_TOPIC
```

Trigger synchronization immediately instead of waiting for n8n:

```bash
docker compose exec n8n node -e \
  'fetch("http://predictor:8080/control/sync",{method:"POST"}).then(async r=>console.log(r.status,await r.text()))'
```

Read the current state from inside the private Compose network:

```bash
docker compose exec n8n node -e \
  'fetch("http://predictor:8080/notifications/status").then(async r=>console.log(r.status,await r.text()))'
```

Expected output contains either `{"enabled":true}` or `{"enabled":false}`. Relevant predictor log events are `notifications_toggled`, `control_command_ignored`, `control_sync_failed`, and `poll_skipped` with reason `notifications_disabled`.

Official ntfy references: [publishing messages](https://docs.ntfy.sh/publish/) and [polling cached JSON messages with `since`](https://docs.ntfy.sh/subscribe/api/#poll-for-messages).
