import { normalizePhoneE164 } from "./phone";

export type RecipientStatus =
  | "eligible"
  | "no_consent"
  | "opt_out"
  | "invalid_phone"
  | "duplicate";

export type ResolvedContact = {
  /** existing contact id when matched in DB; undefined for new rows */
  id?: string;
  name: string;
  phone_e164: string | null;
  rawPhone: string;
  email?: string | null;
  tags: string[];
  consent: boolean;
  optOut: boolean;
  source: "list" | "tags" | "import" | "manual";
  status: RecipientStatus;
};

export type ResolveSummary = {
  found: number;
  eligible: number;
  blockedOptOut: number;
  blockedNoConsent: number;
  invalidPhone: number;
  duplicates: number;
};

export function emptySummary(): ResolveSummary {
  return {
    found: 0,
    eligible: 0,
    blockedOptOut: 0,
    blockedNoConsent: 0,
    invalidPhone: 0,
    duplicates: 0,
  };
}

export type RawRow = {
  name?: string;
  phone: string;
  email?: string | null;
  tags?: string[];
  consent?: boolean;
};

/** Classify and dedupe a set of raw rows. Pure — safe on both client/server. */
export function classifyRows(
  rows: RawRow[],
  source: ResolvedContact["source"],
  existing: Map<string, { id: string; consent: boolean; opt_out_at: string | null; tags: string[] }>,
): { contacts: ResolvedContact[]; summary: ResolveSummary } {
  const summary = emptySummary();
  const seen = new Set<string>();
  const out: ResolvedContact[] = [];

  for (const row of rows) {
    summary.found++;
    const phone = normalizePhoneE164(row.phone ?? "");
    const base: ResolvedContact = {
      name: (row.name ?? "").trim() || phone || row.phone || "(sem nome)",
      phone_e164: phone,
      rawPhone: row.phone,
      email: row.email ?? null,
      tags: row.tags ?? [],
      consent: !!row.consent,
      optOut: false,
      source,
      status: "eligible",
    };

    if (!phone) {
      base.status = "invalid_phone";
      summary.invalidPhone++;
      out.push(base);
      continue;
    }
    if (seen.has(phone)) {
      base.phone_e164 = phone;
      base.status = "duplicate";
      summary.duplicates++;
      out.push(base);
      continue;
    }
    seen.add(phone);

    const ex = existing.get(phone);
    if (ex) {
      base.id = ex.id;
      base.consent = ex.consent;
      base.optOut = !!ex.opt_out_at;
      // merge tags so caller can see effective tag set
      base.tags = Array.from(new Set([...(ex.tags ?? []), ...base.tags]));
    }

    if (base.optOut) {
      base.status = "opt_out";
      summary.blockedOptOut++;
    } else if (!base.consent) {
      base.status = "no_consent";
      summary.blockedNoConsent++;
    } else {
      base.status = "eligible";
      summary.eligible++;
    }
    out.push(base);
  }
  return { contacts: out, summary };
}

/** Substitute {{nome}}, {{telefone}}, {{empresa}} in template. */
export function renderTemplate(
  template: string,
  ctx: { name: string; phone: string; empresa?: string },
): string {
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, ctx.name)
    .replace(/\{\{\s*telefone\s*\}\}/gi, ctx.phone)
    .replace(/\{\{\s*empresa\s*\}\}/gi, ctx.empresa ?? "");
}