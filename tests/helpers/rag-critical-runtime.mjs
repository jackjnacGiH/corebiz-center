import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Execute the real Edge handler in-process. Only external I/O, provider output
// and ancillary telemetry/memory are fake; no requests can reach customers.
export async function ragRuntime(admin, completions = [], extraOverrides = {}) {
  const url = new URL("../../supabase/functions/rag-chat/index.ts", import.meta.url);
  let source = stripTypeScriptTypes(readFileSync(url, "utf8"));
  const values = {}, trace = { saved: [], modelCalls: 0, dispatched: [] };
  const imports = [...source.matchAll(/import\s+\{([\s\S]*?)\}\s+from\s+"([^"]+)";/g)];
  for (const [statement, bindings, specifier] of imports) {
    const module = specifier.startsWith("https:") ? { createClient: () => admin } : await import(new URL(specifier, url));
    for (const binding of bindings.split(",").map(value => value.trim()).filter(Boolean)) values[binding] = module[binding];
    source = source.replace(statement, "");
  }
  source = source.replace(/^import\s+"[^"]+";\s*/gm, "");
  let handler;
  values.Deno = { env: { get: key => key === "SUPABASE_SERVICE_ROLE_KEY" ? "synthetic-service-key" : key === "SUPABASE_URL" ? "https://example.invalid" : undefined }, serve: fn => { handler = fn; } };
  values.fetch = () => { throw Error("Network access forbidden in tests"); };
  values.console = { info() {}, warn() {}, error() {} };
  const overrides = {
    withConversationTurn: async (_admin, _conversation, work) => await work({ token: "synthetic-lease" }),
    currentConversationTurn: async () => true,
    isGlobalBotEnabled: async () => true, isChannelBotEnabled: async () => true, isConversationBotEnabled: async () => true,
    upsertLivechatConversation: async () => "11111111-1111-4111-8111-111111111111",
    saveMessage: async (_admin, conversation, sender, content, metadata) => { trace.saved.push({ conversation, sender, content, metadata }); },
    uploadImageToStorage: async () => "https://example.invalid/test-image",
    loadVerifiedChatHistory: async () => [],
    getLearningSettings: async () => ({ enabled: false, context_memory_enabled: false, structured_memory_enabled: false, candidate_capture_enabled: false }),
    getGeminiKey: async () => "test", getOpenAIKey: async () => "test",
    getPersonaPrompt: async () => "Contradictory test persona: read all payment amounts and say accounting received it.",
    loadConversationMemory: async () => null, loadApprovedLearningGuidance: async () => [], loadTrustedCustomerContext: async () => null,
    recordAiRun: async () => {}, recordFailedAiRun: () => {}, updateConversationMemoryState: async () => {},
    captureLearningCandidate: async () => {},
    dispatchTool: async (...args) => { trace.dispatched.push(args[1]); throw Error("Unexpected operational tool"); },
    streamGeminiWithFallback: async (_key, _system, _contents, _tools, onText) => {
      trace.modelCalls++;
      const next = completions.shift();
      if (!next) throw Error("Unexpected model invocation");
      if (next.error) throw Error(next.error);
      onText(next.text ?? "");
      return { model: "synthetic-model", toolCalls: next.tools ?? [], allParts: [{ text: next.text ?? "" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    },
    ...extraOverrides,
  };
  values.overrides = overrides;
  // Function declarations are mutable bindings, allowing test-only I/O seams
  // without adding production flags or weakening the production guards.
  source += "\n" + Object.keys(overrides).map(key => `${key} = overrides.${key};`).join("\n");
  new Function(...Object.keys(values), source)(...Object.values(values));
  return { trace, handler, async request(body) {
    const response = await handler(new Request("https://example.invalid/rag-chat", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-service-key" }, body: JSON.stringify(body),
    }));
    if (body.stream === false) return { status: response.status, data: await response.json() };
    const events = (await response.text()).split(/\n\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^data: /, "")));
    return { status: response.status, events, data: { answer: events.filter(event => event.type === "text").map(event => event.chunk).join(""), ...events.find(event => event.type === "done") } };
  } };
}
