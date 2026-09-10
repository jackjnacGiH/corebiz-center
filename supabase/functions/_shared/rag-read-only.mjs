const READ_ONLY_SAFE_TOOL_NAMES = new Set([
  "find_products",
  "get_product_detail",
  "list_product_groups",
  "get_group_members",
  "list_categories",
]);

export function resolveReadOnlyRequest({ requested, internalServiceCall, hasSessionId, hasConversationId }) {
  if (!requested) return { enabled: false, status: null, error: null };
  if (!internalServiceCall) {
    return {
      enabled: false,
      status: 403,
      error: "read_only is available only to the internal service role",
    };
  }
  if (hasSessionId || hasConversationId) {
    return {
      enabled: false,
      status: 400,
      error: "read_only requires a request without session_id or conversation_id",
    };
  }
  return { enabled: true, status: null, error: null };
}

export function readOnlyToolDecision(toolName, readOnly) {
  if (!readOnly || READ_ONLY_SAFE_TOOL_NAMES.has(toolName)) {
    return { execute: true, recordSuppressed: false, result: null };
  }
  return {
    execute: false,
    recordSuppressed: true,
    result: {
      ok: false,
      suppressed: true,
      read_only: true,
      reason: "read_only",
    },
  };
}
