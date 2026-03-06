import React, { useState } from 'react';
import { Send, Bot, Loader2 } from 'lucide-react';

const N8nAssistant: React.FC = () => {
    const [input, setInput] = useState('');
    const [response, setResponse] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // *Note*: The provided URL was a Workflow Editor URL. 
    // n8n Webhook URLs normally look like: ".../webhook/your-path-name" or ".../webhook-test/your-path-name".
    // Please update this URL to exactly what the n8n Webhook Node shows inside the workflow.
    const WEBHOOK_URL = 'https://n8n.srv1315112.hstgr.cloud/webhook/LZ9tnL6dCkYuIPn6';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        setIsLoading(true);
        setError(null);
        setResponse(null);

        try {
            const res = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: input })
            });

            if (!res.ok) {
                throw new Error(`Error: ${res.status} ${res.statusText}`);
            }

            // Waiting for reply from n8n webhook
            const data = await res.json();

            // Assume the reply has a "reply" field or format it from raw data
            if (data && data.reply) {
                setResponse(data.reply);
            } else if (typeof data === 'string') {
                setResponse(data);
            } else {
                setResponse(JSON.stringify(data, null, 2));
            }
        } catch (err: any) {
            setError(err.message || 'Failed to connect to the webhook. Please make sure the n8n webhook is active and CORS is enabled.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="glass-card mt-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Bot className="text-primary" />
                AI Workflow Assistant (n8n Webhook)
            </h2>
            <p className="text-muted text-sm mb-4">
                Send a message to trigger your n8n workflow and wait for the reply.
            </p>

            <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Enter your prompt or text here..."
                    className="flex-1"
                    style={{
                        padding: '0.75rem 1rem',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--panel-border)',
                        color: 'var(--text-main)',
                        outline: 'none',
                        fontSize: '0.95rem'
                    }}
                    disabled={isLoading}
                />
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLoading || !input.trim()}
                    style={{ minWidth: '120px' }}
                >
                    {isLoading ? <Loader2 className="animate-spin" size={18} /> : <><Send size={18} /> Send</>}
                </button>
            </form>

            {(response || error) && (
                <div style={{
                    padding: '1rem',
                    borderRadius: '8px',
                    background: error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    border: `1px solid ${error ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
                    marginTop: '1rem'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {error ? <span className="text-danger">Failed to execute</span> : <span className="text-success">Workflow Reply</span>}
                    </div>
                    {error ? (
                        <div className="text-danger text-sm">{error}</div>
                    ) : (
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem', color: 'var(--text-main)' }}>
                            {response}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

export default N8nAssistant;
