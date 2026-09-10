import { format } from 'date-fns';

/** Formats the persisted pickup window; missing schedule is explicitly ASAP. */
export function formatPickupSchedule(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'ASAP';
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'ASAP';
  const endTime = endDate && !Number.isNaN(endDate.getTime()) ? `–${format(endDate, 'h:mm a')}` : '';
  return `${format(startDate, 'MMM d, yyyy')} · ${format(startDate, 'h:mm a')}${endTime}`;
}