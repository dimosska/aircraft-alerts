# Later migration to local ADS-B

OpenSky is isolated behind an ADS-B adapter and the prediction core consumes normalized measurements. A future `readsb` or `dump1090` adapter only needs to map its fields to the existing model:

- `hex` → ICAO24;
- `flight` → callsign;
- `category`/emitter category → numeric `category` compatible with the OpenSky values when available;
- `lat`, `lon`, `seen_pos` → timestamped position;
- `gs` knots → ground speed in metres/second;
- `track` → true track;
- `alt_geom`/`alt_baro` feet → metres;
- `geom_rate`/`baro_rate` feet/minute → metres/second;
- `track_rate`, `nic`, `rc`, `nac_p` → optional quality/stability inputs.

`readsb` normally refreshes `aircraft.json` once per second and can also emit a JSON object for each new position. A local adapter should poll every 5 seconds, set `ADSB_SOURCE=readsb`, and keep the same Redis, prediction and ntfy layers. The readsb endpoint must remain on the private LAN or Docker network and must not be exposed to the public internet.

Before switching production traffic, replay the same captured approach through both adapters and compare position age, barometric altitude, vertical rate, emitter category and distance to EPKK. Local data may update every few seconds, but the same aircraft-category, altitude, descent and distance gates should remain in effect. If a receiver cannot provide a compatible category, use an exact ICAO24 override only for aircraft you intentionally want to retain.

Authoritative format reference: [readsb JSON output](https://github.com/wiedehopf/readsb/blob/dev/README-json.md).
