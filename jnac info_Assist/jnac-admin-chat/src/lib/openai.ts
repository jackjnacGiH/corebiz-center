import { hasOpenAIConfig, OPENAI_MODEL } from "@/lib/config";

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (response.output_text) return response.output_text;
  const text = response.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n");
  return text || null;
}

export async function generateAdminAnswer(params: {
  question: string;
  contextText: string;
}) {
  if (!hasOpenAIConfig()) {
    return [
      "ยังไม่ได้ตั้งค่า OPENAI_API_KEY จึงตอบด้วยข้อมูลค้นคืนโดยตรง",
      params.contextText || "ไม่พบข้อมูลที่ตรงกับคำถามในฐานข้อมูลปัจจุบัน",
    ].join("\n\n");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions:
        "คุณคือผู้ช่วยสำหรับแอดมิน JNAC เท่านั้น ตอบภาษาไทย กระชับ ตรวจสอบราคาและคงเหลือจากบริบทที่ให้เท่านั้น ถ้าไม่มีราคา/คงเหลือให้ระบุว่าไม่พบข้อมูลในฐานปัจจุบัน ห้ามเดาราคา ห้ามเดาสต๊อก",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `คำถามแอดมิน:\n${params.question}\n\nบริบทจากฐานข้อมูล:\n${params.contextText || "ไม่พบข้อมูลที่ตรง"}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as unknown;
  return extractOutputText(payload) ?? "ไม่สามารถอ่านข้อความตอบกลับจาก OpenAI ได้";
}
