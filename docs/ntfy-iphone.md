# ntfy setup for two iPhones

Topics on `ntfy.sh` are public and effectively act as passwords. Use two unrelated random values of at least 32 characters; the provided command generates 48 hexadecimal characters.

## iPhone 1

1. Install the official **ntfy** app from the Apple App Store.
2. Allow notifications when iOS asks.
3. Add a subscription to `https://ntfy.sh/<NTFY_TOPIC_IPHONE_1>` using the value from the server’s local `.env`.
4. Do not subscribe this phone to the second topic unless both streams are intentionally desired.

## iPhone 2

Repeat the same steps with `https://ntfy.sh/<NTFY_TOPIC_IPHONE_2>`.

Do not paste either topic into chat, screenshots, tickets, Git commits, shell history shared with others, or public password managers.

## Test

From the project directory on the server:

```bash
docker compose run --rm --no-deps predictor node scripts/push-smoke.js iphone1
docker compose run --rm --no-deps predictor node scripts/push-smoke.js iphone2
```

Both commands should print only the target identifier and should produce one notification on the corresponding phone. If delivery fails, verify the topic character-for-character and check iOS notification permissions, Focus mode, and Background App Refresh.

Official references: [ntfy phone subscriptions](https://docs.ntfy.sh/subscribe/phone/) and [publishing/API limits](https://docs.ntfy.sh/publish/).
