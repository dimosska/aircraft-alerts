export function classifyAircraft(aircraft, rules) {
  const icao24 = String(aircraft.icao24 ?? '').trim().toLowerCase();
  const callsign = String(aircraft.callsign ?? '').trim().toUpperCase();

  if (rules.allowedIcao24.includes(icao24)) {
    return { eligible: true, matchedBy: 'icao24_allowlist' };
  }

  if (rules.allowedCategories.includes(aircraft.category)) {
    return { eligible: true, matchedBy: `category:${aircraft.category}` };
  }

  const categoryUnknown = aircraft.category === null || [0, 1].includes(aircraft.category);
  const operatorStyleCallsign = /^[A-Z]{3}[A-Z0-9]{1,5}$/.test(callsign) && /\d/.test(callsign.slice(3));
  if (rules.allowOperatorCallsignFallback && categoryUnknown && operatorStyleCallsign) {
    return { eligible: true, matchedBy: 'operator_callsign_fallback' };
  }

  return { eligible: false, matchedBy: null };
}
