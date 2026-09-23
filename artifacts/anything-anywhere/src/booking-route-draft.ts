export const bookingDraftStorageKey = 'anything-anywhere.booking-draft';

export type BookingLocationSelection = {
  address: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number;
  longitude?: number;
};

export type BookingRouteDraft = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupSelection?: BookingLocationSelection | null;
  dropoffSelection?: BookingLocationSelection | null;
  priority?: 'asap' | 'scheduled';
  scheduledPickupDate?: string;
  scheduledPickupWindow?: string;
  category?: string;
  size?: 'small' | 'medium' | 'large';
  weight?: 'under5' | '5to20' | '20to50';
  care?: 'standard' | 'fragile' | 'priority' | 'temperature';
  pickupName?: string;
  pickupPhone?: string;
  pickupInstructions?: string;
  recipientName?: string;
  recipientPhone?: string;
  deliveryInstructions?: string;
};

type BookingDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readBookingRouteDraft(storage: BookingDraftStorage): BookingRouteDraft {
  try {
    const parsed = JSON.parse(storage.getItem(bookingDraftStorageKey) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as BookingRouteDraft : {};
  } catch {
    return {};
  }
}

export function writeBookingRouteDraft(storage: BookingDraftStorage, draft: BookingRouteDraft) {
  try {
    storage.setItem(bookingDraftStorageKey, JSON.stringify(draft));
  } catch {
    // Booking remains available when browser storage is unavailable.
  }
}

export function clearBookingRouteDraft(storage: BookingDraftStorage) {
  try {
    storage.removeItem(bookingDraftStorageKey);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}