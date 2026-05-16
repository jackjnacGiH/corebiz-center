import { useState, type FormEvent } from 'react';
import { Send, Bot, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const N8nAssistant = () => {
    const [input, setInput] = useState('');
    const [response, setResponse] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // URL สำหรับรับข้อมูล Webhook Production
    const WEBHOOK_URL =
        'https://n8n.srv1315112.hstgr.cloud/webhook/f450c3d8-3d4c-4a74-bfa3-8ebb093bc72c';

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        setIsLoading(true);
        setError(null);
        setResponse(null);

        try {
            // 1. ค้นหาข้อมูล Context จาก Openclaw RAG (Local Server)
            let ragContext = '';
            try {
                const searchRes = await fetch('http://localhost:3001/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: input }),
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData.context && searchData.context.trim() !== '') {
                        ragContext = searchData.context;
                    }
                }
            } catch (searchErr) {
                console.warn(
                    '⚠️ ไม่สามารถดึงข้อมูลจาก Openclaw RAG Data Center ได้:',
                    searchErr,
                );
            }

            // 2. เตรียมข้อความ + ข้อมูล RAG ส่งให้ n8n AI Agent ชุดเดียว
            let finalMessage = input;
            if (ragContext) {
                finalMessage = `(โปรดตอบคำถามโดยอิงจาก "ข้อมูลอ้างอิง" ต่อไปนี้เป็นหลัก)\n\nข้อมูลอ้างอิงจาก Openclaw RAG:\n${ragContext}\n\nคำถามจากผู้ใช้:\n${input}`;
            }

            // 3. ยิงข้อมูลหา n8n Webhook
            const res = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: finalMessage }),
            });

            if (!res.ok) {
                throw new Error(`Error: ${res.status} ${res.statusText}`);
            }

            const data = await res.json();
            if (data && data.reply) {
                setResponse(data.reply);
            } else if (data && data.output) {
                setResponse(data.output);
            } else if (typeof data === 'string') {
                setResponse(data);
            } else {
                setResponse(JSON.stringify(data, null, 2));
            }
        } catch (err: unknown) {
            const msg =
                err instanceof Error
                    ? err.message
                    : 'Failed to connect to the webhook. Please make sure the n8n webhook is active and CORS is enabled.';
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card className="gap-4 py-5">
            <CardHeader className="px-5">
                <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-900">
                    <span className="grid place-items-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600">
                        <Bot size={16} />
                    </span>
                    AI Workflow Assistant
                    <span className="text-xs font-normal text-neutral-500 ml-1">
                        (n8n Webhook)
                    </span>
                </CardTitle>
                <p className="text-xs text-neutral-500 mt-1">
                    Send a message to trigger your n8n workflow and wait for the reply.
                </p>
            </CardHeader>
            <CardContent className="px-5">
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Enter your prompt or text here..."
                        disabled={isLoading}
                        className="flex-1 h-10 rounded-md border border-neutral-200 bg-neutral-50 px-4 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                    />
                    <Button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="gap-2 bg-indigo-500 hover:bg-indigo-600 h-10 px-4"
                    >
                        {isLoading ? (
                            <Loader2 className="animate-spin" size={16} />
                        ) : (
                            <>
                                <Send size={16} /> Send
                            </>
                        )}
                    </Button>
                </form>

                {(response || error) && (
                    <div
                        className={cn(
                            'mt-4 rounded-lg border px-4 py-3',
                            error
                                ? 'border-red-200 bg-red-50'
                                : 'border-emerald-200 bg-emerald-50',
                        )}
                    >
                        <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                            {error ? (
                                <>
                                    <AlertCircle size={14} className="text-red-600" />
                                    <span className="text-red-700">Failed to execute</span>
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 size={14} className="text-emerald-600" />
                                    <span className="text-emerald-700">Workflow Reply</span>
                                </>
                            )}
                        </div>
                        {error ? (
                            <div className="text-sm text-red-700 leading-relaxed">{error}</div>
                        ) : (
                            <pre className="m-0 text-sm text-neutral-800 whitespace-pre-wrap break-words leading-relaxed">
                                {response}
                            </pre>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default N8nAssistant;
