# Later migration to local ADS-B

OpenSky is isolated behind an ADS-B adapter and the prediction core consumes normalized measurements. A future `readsb` or `dump1090` adapter only needs to map its fields to the existing model:

- `hex` → ICAO24;
- `flight` → callsign;
- `lat`, `lon`, `seen_pos` → timestamped position;
- `gs` knots → ground speed in metres/second;
- `track` → true track;
- `alt_geom`/`alt_baro` feet → metres;
- `geom_rate`/`baro_rate` feet/minute → metres/second;
- `track_rate`, `nic`, `rc`, `nac_p` → optional quality/stability inputs.

`readsb` normally refreshes `aircraft.json` once per second and can also emit a JSON object for each new position. A local adapter should poll every 5 seconds, set `ADSB_SOURCE=readsb`, and keep the same Redis, prediction and ntfy layers. The readsb endpoint must remain on the private LAN or Docker network and must not be exposed to the public internet.

Before switching production traffic, replay the same captured approach through both adapters and compare ETA, CPA distance, altitude and confidence. Local coverage must detect an aircraft early enough to accumulate at least three measurements before the 90–150 second alert window.

Authoritative format reference: [readsb JSON output](https://github.com/wiedehopf/readsb/blob/dev/README-json.md).
