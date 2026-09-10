export function customerTimeZoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
}

export const pickupWindows = [
  ['08:00', '10:00', '8–10 AM'],
  ['10:00', '12:00', '10 AM–12 PM'],
  ['12:00', '14:00', '12–2 PM'],
  ['14:00', '16:00', '2–4 PM'],
  ['16:00', '18:00', '4–6 PM'],
] as const;

/** Convert a local calendar date/window into API timestamps, rejecting unusable choices. */
export function pickupScheduleTimestamps(date: string, window: string) {
  const match = pickupWindows.find(([start]) => start === window);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T${match[0]}:00`);
  const end = new Date(`${date}T${match[1]}:00`);
  const normalized = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || normalized !== date || end <= start || start.getTime() <= Date.now()
    ? null
    : { start: start.toISOString(), end: end.toISOString() };
}

export function formatCustomerPickupSchedule(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return `${startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}, ${startDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}–${endDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })} (${customerTimeZoneLabel()})`;
}