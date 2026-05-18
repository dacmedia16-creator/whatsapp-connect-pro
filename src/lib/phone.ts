import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizePhoneE164(input: string, defaultCountry: "BR" = "BR"): string | null {
  if (!input) return null;
  const cleaned = input.trim();
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function formatPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}