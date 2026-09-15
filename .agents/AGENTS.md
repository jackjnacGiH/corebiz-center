# Antigravity AI Custom Rules for CoreBiz Center

## Mandatory Token-Efficient Code Change Rules
- **Treat token cost as a primary constraint:** For every code change, define the narrowest possible scope and fix only the evidenced problem. Do not broaden the task into unrelated modules.
- **Read only what is needed:** Start with the exact target files and their immediate dependencies. Use focused searches and small line ranges; do not scan or print the entire repository, large generated files, or full logs unless evidence shows it is necessary.
- **Prefer small patches:** Follow the existing codebase pattern and make the smallest reversible patch that solves the issue. Do not perform broad refactors, rewrites, dependency changes, or architecture changes unless the user explicitly requests them or correctness requires them.
- **Use no subagents by default:** Do not delegate or start parallel agents unless the user explicitly asks for delegation or the task cannot be completed safely in one focused pass.
- **Work in at most two focused change sets:** Group closely related edits, verify each change set with the narrowest relevant test, and avoid repeated edit/test cycles caused by speculative changes.
- **Test economically:** Run targeted tests or checks after each change set. Run the full build once at the end, unless a failure or a material new change makes another full run necessary.
- **Keep tool output compact:** Set output limits, summarize routine results, and fetch only the logs, rows, or code sections required to make the next decision. Never expose secrets while reducing output.
- **Measure before and after performance work:** Record a small reproducible baseline, apply the focused fix, then compare the same measurement. Stop adding optimizations once the agreed target is met.
- **Protect production behavior:** For production behavior changes, use an existing feature flag or another simple reversible rollout mechanism when practical. Release one change set at a time and keep a clear rollback path.
- **Do not add paid services:** If a proposed solution adds API, subscription, infrastructure, or model cost, choose a no-additional-cost approach unless Boss jack explicitly approves the expense.
- **Report scope and verification:** At completion, state the files changed, targeted checks run, full-build result when applicable, production verification when deployed, and any remaining limitation in a concise summary.

## Chatbot Product Recommendation List Rules
- **Mandate Numbered Lists:** Every time the chatbot (`rag-chat` edge function) offers options or alternative products to the customer to choose from, it must present them as a numbered list starting with `1.`, `2.`, `3.` (do NOT use emojis like `✨` or bullet points like `•` for these lists).
- **Enforce Quick Replies:** The LINE Messaging API integration (`line-webhook` edge function) must parse these numbered lists and automatically attach Quick Reply buttons for the customer to select easily.
- **Button Behavior:** Tapping a Quick Reply button must send the exact product name to the chatbot, enabling an immediate, exact product detail lookup.
