# Antigravity AI Custom Rules for CoreBiz Center

## Chatbot Product Recommendation List Rules
- **Mandate Numbered Lists:** Every time the chatbot (`rag-chat` edge function) offers options or alternative products to the customer to choose from, it must present them as a numbered list starting with `1.`, `2.`, `3.` (do NOT use emojis like `✨` or bullet points like `•` for these lists).
- **Enforce Quick Replies:** The LINE Messaging API integration (`line-webhook` edge function) must parse these numbered lists and automatically attach Quick Reply buttons for the customer to select easily.
- **Button Behavior:** Tapping a Quick Reply button must send the exact product name to the chatbot, enabling an immediate, exact product detail lookup.
