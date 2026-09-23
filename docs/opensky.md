# OpenSky credentials and operating limits

OpenSky accepts OAuth2 Client Credentials. Basic authentication with an account username/password is no longer supported.

1. Register or sign in at [OpenSky Network](https://opensky-network.org/).
2. Open the account page and create an API client.
3. Put its client ID in `OPENSKY_CLIENT_ID` and its secret in `OPENSKY_CLIENT_SECRET` in the server’s local `.env`.
4. Never add these values to n8n nodes, workflow JSON, Git, or support messages.

The predictor exchanges the client credentials for a short-lived Bearer token, caches it in memory, refreshes it before expiry, and retries once after HTTP 401. Tokens and credentials are never included in application logs.

The default search box is derived from `OPENSKY_SEARCH_RADIUS_KM=90` around EPKK and remains below 25 square degrees, so `/states/all` costs one credit per request under the documented rules. At one request every 30 seconds, continuous operation consumes 2,880 credits per day. Do not configure 15-second source polling with a standard 4,000-credit account: it requires 5,760 credits per day.

HTTP 401, 429, timeouts, malformed replies, and other source failures produce a sanitized degraded result. The following n8n execution will still run. On 429, inspect the OpenSky response headers and increase `ADSB_POLL_INTERVAL_SECONDS` if necessary.

Only state vectors with a numeric `time_position` are accepted. `last_contact` is not a position timestamp: it can advance when OpenSky receives a non-position Mode S message while latitude and longitude remain stale. The adapter therefore drops coordinates without `time_position` instead of fabricating a new trajectory sample.

Official reference: [OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html).
