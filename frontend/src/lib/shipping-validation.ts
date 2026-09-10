import type {
  ShippingDraftFieldIssue,
  ShippingDraftFieldName,
  ShippingDraftFieldReason,
} from "../../../supabase/functions/_shared/shipping-domain";

export interface ShippingDraftValidationCopy {
  draftFields: Record<ShippingDraftFieldName, string>;
  draftFieldReasons: Record<ShippingDraftFieldReason, string>;
  draftBoxField: string;
  draftProductField: string;
}

/** Formats only server-generated, whitelisted metadata; no entered value is rendered. */
export function shippingDraftFieldIssueMessage(
  issue: ShippingDraftFieldIssue,
  copy: ShippingDraftValidationCopy,
): string {
  let field = copy.draftFields[issue.field] ?? copy.draftFields.draft;
  if (issue.index !== undefined) {
    const template = issue.field === "parcels" || issue.field.startsWith("parcels.")
      ? copy.draftBoxField
      : copy.draftProductField;
    field = template
      .replace("{field}", field)
      .replace("{index}", String(issue.index + 1));
  }
  return copy.draftFieldReasons[issue.reason]
    .replace("{field}", field)
    .replace("{limit}", String(issue.limit ?? ""));
}
