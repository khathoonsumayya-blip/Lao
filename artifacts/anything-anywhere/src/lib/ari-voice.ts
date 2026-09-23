import type { BookingRouteDraft } from '@/booking-route-draft';

export type AriBookingDraft = BookingRouteDraft;

type SpeechRecognitionResultLike = {
  0?: { transcript?: string };
  isFinal?: boolean;
};

export type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function browserSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function voiceSupportMessage() {
  if (typeof navigator === 'undefined') return 'Voice recognition is unavailable here. Type your request instead.';
  const isIPad = /iPad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(navigator.userAgent)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium)/i.test(navigator.userAgent);
  if (isIPad && isSafari) {
    return 'Voice recognition is not supported by iPad Safari in this app. Type your request below, or use a supported desktop or Android browser.';
  }
  return 'Voice recognition is not supported by this browser. Type your request below instead.';
}

function localDate(offsetDays: number) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function cleanCapturedText(value?: string) {
  return value?.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim() || undefined;
}

function mappedCategory(text: string) {
  const categories: Array<[RegExp, string]> = [
    [/\b(document|paperwork|letter|envelope)s?\b/i, 'Documents'],
    [/\b(food|meal|takeout)\b/i, 'Food'],
    [/\b(grocer|produce|shopping)\w*\b/i, 'Groceries'],
    [/\b(medicine|medication|prescription)\b/i, 'Medicine'],
    [/\b(baby|diaper|formula)\b/i, 'Baby items'],
    [/\b(pet|dog|cat)\b/i, 'Pet items'],
    [/\b(gift|present)\b/i, 'Gifts'],
    [/\b(electronic|laptop|tablet|computer)\w*\b/i, 'Electronics'],
    [/\b(clothing|clothes|shirt|dress)\b/i, 'Clothing'],
    [/\b(parcel|package|box)\b/i, 'Small parcels'],
  ];
  return categories.find(([pattern]) => pattern.test(text))?.[1];
}

function mappedWindow(text: string) {
  const windows: Array<[RegExp, BookingRouteDraft['scheduledPickupWindow']]> = [
    [/\b(?:8|eight)\s*(?:a\.?m\.?)?\s*(?:to|-|through)\s*(?:10|ten)\s*(?:a\.?m\.?)?\b/i, '08:00'],
    [/\b(?:10|ten)\s*(?:a\.?m\.?)?\s*(?:to|-|through)\s*(?:12|twelve|noon)\b/i, '10:00'],
    [/\b(?:12|twelve|noon)\s*(?:to|-|through)\s*(?:2|two)\s*(?:p\.?m\.?)?\b/i, '12:00'],
    [/\b(?:2|two)\s*(?:p\.?m\.?)?\s*(?:to|-|through)\s*(?:4|four)\s*(?:p\.?m\.?)?\b/i, '14:00'],
    [/\b(?:4|four)\s*(?:p\.?m\.?)?\s*(?:to|-|through)\s*(?:6|six)\s*(?:p\.?m\.?)?\b/i, '16:00'],
  ];
  return windows.find(([pattern]) => pattern.test(text))?.[1];
}

function mappedPhone(value?: string) {
  if (!value) return undefined;
  const match = value.match(/(?:\+?1[\s().-]*)?(\d{3})[\s().-]*(\d{3})[\s.-]*(\d{4})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function contactDetails(text: string, kind: 'pickup' | 'delivery') {
  const boundary = kind === 'pickup' ? '(?:delivery|drop ?off|recipient)' : '(?:pickup|sender)';
  const label = kind === 'pickup' ? '(?:pickup contact|sender)' : '(?:delivery contact|recipient)';
  const section = text.match(new RegExp(`\\b${label}\\b(?:\\s+(?:is|will be))?\\s+(.+?)(?=\\s+${boundary}\\b|\\s+(?:pickup|delivery) instructions?\\b|$)`, 'i'))?.[1];
  if (!section) return {};
  const phone = mappedPhone(section);
  const name = cleanCapturedText(section
    .replace(/(?:phone|number|at|on)?\s*(?:\+?1[\s().-]*)?\d{3}[\s().-]*\d{3}[\s.-]*\d{4}.*/i, '')
    .replace(/\b(?:named|name is)\b/i, ''));
  return { name, phone };
}

export function parseAriBookingRequest(text: string, current: AriBookingDraft = {}) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const next: AriBookingDraft = { ...current };

  const route = normalized.match(/\b(?:pickup|pick up)(?!\s+(?:contact|instructions?)\b)\s+(?:from|at|is|address is)?\s*(.+?)\s+(?:and\s+)?(?:deliver|delivery|drop ?off)(?!\s+(?:contact|instructions?)\b)\s+(?:to|at|is|address is)?\s*(.+?)(?=\s+(?:with|for|package|parcel|box|document|food|grocer|medicine|gift|electronic|clothing|small|medium|large|fragile|priority|temperature|weigh|asap|as soon|today|tomorrow|pickup contact|sender|delivery contact|recipient|instructions?)\b|$)/i);
  if (route) {
    next.pickupAddress = cleanCapturedText(route[1]);
    next.dropoffAddress = cleanCapturedText(route[2]);
    next.pickupSelection = null;
    next.dropoffSelection = null;
  } else {
    const pickup = normalized.match(/\b(?:pickup|pick up)(?!\s+(?:contact|instructions?)\b)\s+(?:from|at|is|address is)\s+(.+)$/i);
    const dropoff = normalized.match(/\b(?:deliver|delivery|drop ?off)(?!\s+(?:contact|instructions?)\b)\s+(?:to|at|is|address is)\s+(.+)$/i);
    if (pickup) {
      next.pickupAddress = cleanCapturedText(pickup[1]);
      next.pickupSelection = null;
    }
    if (dropoff) {
      next.dropoffAddress = cleanCapturedText(dropoff[1]);
      next.dropoffSelection = null;
    }
  }

  const category = mappedCategory(normalized);
  if (category) next.category = category;
  if (/\bsmall\b/i.test(normalized)) next.size = 'small';
  if (/\bmedium\b/i.test(normalized)) next.size = 'medium';
  if (/\b(large|bulky)\b/i.test(normalized)) next.size = 'large';
  const weight = normalized.match(/\b(\d{1,2})\s*(?:pounds?|lbs?)\b/i)?.[1];
  if (weight) {
    const pounds = Number(weight);
    next.weight = pounds < 5 ? 'under5' : pounds <= 20 ? '5to20' : '20to50';
  }
  if (/\bfragile\b/i.test(normalized)) next.care = 'fragile';
  else if (/\btemperature(?: sensitive)?|keep (?:it )?(?:cold|warm)\b/i.test(normalized)) next.care = 'temperature';
  else if (/\bpriority|time sensitive|urgent\b/i.test(normalized)) next.care = 'priority';
  else if (/\bstandard|normal handling\b/i.test(normalized)) next.care = 'standard';

  if (/\b(asap|as soon as possible|right away|immediately)\b/i.test(normalized)) {
    next.priority = 'asap';
    next.scheduledPickupDate = '';
    next.scheduledPickupWindow = '';
  } else if (/\b(today|tomorrow|schedule|scheduled)\b/i.test(normalized)) {
    next.priority = 'scheduled';
    if (/\btomorrow\b/i.test(normalized)) next.scheduledPickupDate = localDate(1);
    else if (/\btoday\b/i.test(normalized)) next.scheduledPickupDate = localDate(0);
    const isoDate = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (isoDate) next.scheduledPickupDate = isoDate;
    const window = mappedWindow(normalized);
    if (window) next.scheduledPickupWindow = window;
  }

  const pickupContact = contactDetails(normalized, 'pickup');
  if (pickupContact.name) next.pickupName = pickupContact.name;
  if (pickupContact.phone) next.pickupPhone = pickupContact.phone;
  const deliveryContact = contactDetails(normalized, 'delivery');
  if (deliveryContact.name) next.recipientName = deliveryContact.name;
  if (deliveryContact.phone) next.recipientPhone = deliveryContact.phone;

  const pickupInstructions = normalized.match(/\bpickup instructions?(?: are| is|:)?\s+(.+?)(?=\s+delivery instructions?\b|$)/i)?.[1];
  const deliveryInstructions = normalized.match(/\b(?:delivery|drop ?off) instructions?(?: are| is|:)?\s+(.+)$/i)?.[1];
  if (pickupInstructions) next.pickupInstructions = cleanCapturedText(pickupInstructions);
  if (deliveryInstructions) next.deliveryInstructions = cleanCapturedText(deliveryInstructions);

  return next;
}

export function ariDraftQuestions(draft: AriBookingDraft) {
  const questions: string[] = [];
  if (!draft.pickupAddress) questions.push('Where should the driver pick up the package?');
  else if (!draft.pickupSelection) questions.push('Select a verified pickup address from the matches.');
  if (!draft.dropoffAddress) questions.push('Where should the driver deliver it?');
  else if (!draft.dropoffSelection) questions.push('Select a verified delivery address from the matches.');
  if (!draft.category || !draft.size || !draft.weight || !draft.care) questions.push('What are you sending, its size and weight, and how should it be handled?');
  if (!draft.priority) questions.push('Should pickup be ASAP or scheduled?');
  if (draft.priority === 'scheduled' && (!draft.scheduledPickupDate || !draft.scheduledPickupWindow)) questions.push('Choose the scheduled pickup date and two-hour window.');
  if (!draft.pickupName || !draft.pickupPhone) questions.push('What are the pickup contact’s name and phone number?');
  if (!draft.recipientName || !draft.recipientPhone) questions.push('What are the delivery contact’s name and phone number?');
  return questions;
}

export function recognitionErrorMessage(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'Microphone permission was denied. Allow microphone access in browser settings, or type your request instead.';
  if (error === 'no-speech') return 'I did not hear any speech. Try again, speak clearly, or type your request.';
  if (error === 'audio-capture') return 'No working microphone was found. Check the device microphone or type your request.';
  if (error === 'network') return 'Speech recognition could not reach the browser service. Check your connection or type your request.';
  return 'Speech recognition stopped before I could understand you. Try again or type your request.';
}