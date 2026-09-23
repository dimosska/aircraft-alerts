export function classifyAircraft(aircraft, rules) {
  const icao24 = String(aircraft.icao24 ?? '').trim().toLowerCase();

  if (rules.allowedIcao24.includes(icao24)) {
    return { eligible: true, matchedBy: 'icao24_allowlist' };
  }

  if (rules.allowedCategories.includes(aircraft.category)) {
    return { eligible: true, matchedBy: `category:${aircraft.category}` };
  }

  return { eligible: false, matchedBy: null };
}
