import { format } from 'date-fns';

/** Formats the persisted pickup window, or clearly labels an unscheduled delivery. */
export function formatPickupSchedule(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'ASAP';
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) return 'ASAP';
  const date = format(startDate, 'MMM d, yyyy');
  const startTime = format(startDate, 'h:mm a');
  const endTime = endDate && !Number.isNaN(endDate.getTime()) ? format(endDate, 'h:mm a') : null;
  return `${date} · ${startTime}${endTime ? `–${endTime}` : ''}`;
}