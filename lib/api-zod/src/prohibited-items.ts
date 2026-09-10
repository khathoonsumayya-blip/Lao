export const PROHIBITED_ITEMS_POLICY_VERSION = "v1";

export const PROHIBITED_ITEMS = [
  "Weapons or ammunition",
  "Explosives, flammable, or hazardous materials",
  "Illegal drugs or other unlawful items",
  "Cash, currency, or negotiable instruments",
  "Live animals",
] as const;

export const PROHIBITED_ITEMS_CONFIRMATION_TEXT =
  "I confirm that my package does not contain any prohibited items.";

export const PROHIBITED_ITEMS_CONFIRMATION_ERROR =
  "Please confirm that your package does not contain prohibited items before continuing.";