import { useState, type FormEvent } from 'react';
import { Send, Plus, PhoneCall, Video } from 'lucide-react';

const Chat = () => {
    const [msg, setMsg] = useState('');
    const [chatHistory, setChatHistory] = useState([
        { sender: 'System AI', text: 'Welcome to Omni-Channel Chat. Waiting for new messages...', time: '10:00 AM' },
        { sender: 'Somchai (LINE OA)', text: 'Is the ergonomic chair in stock?', time: '10:15 AM' }
    ]);

    const handleSend = (e: FormEvent) => {
        e.preventDefault();
        if (!msg.trim()) return;
        setChatHistory([...chatHistory, { sender: 'You', text: msg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        setMsg('');
    };

    return (
        <div className="animate-fade-in" style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexShrink: 0 }}>
                <div>
                    <h1 className="text-2xl font-bold">Omni-Channel Chat</h1>
                    <p className="text-muted">Manage conversations from LINE, FB, WhatsApp centrally</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}><PhoneCall size={16} /> Call</button>
                    <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}><Video size={16} /> Video</button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>

                {/* Chat List Box */}
                <div className="glass-card" style={{ width: '300px', display: 'flex', flexDirection: 'column', padding: '1rem 0' }}>
                    <div style={{ padding: '0 1rem 1rem 1rem', borderBottom: '1px solid var(--panel-border)', fontWeight: 600 }}>Active Chats (12)</div>
                    <div style={{ overflowY: 'auto', flex: 1, padding: '1rem 0' }}>
                        {['Somchai (LINE OA)', 'Manee (Messenger)', 'Anna (Instagram)', 'John (WhatsApp)'].map((name, i) => (
                            <div key={i} style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '1rem', alignItems: 'center', cursor: 'pointer', background: i === 0 ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--secondary))', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {name.charAt(0)}
                                </div>
                                <div style={{ overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Recent message preview...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Chat Box */}
                <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden' }}>
                    <div style={{ padding: '1rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--secondary))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>S</div>
                        <div>
                            <div style={{ fontWeight: 600 }}>Somchai (LINE OA)</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--success)' }}>Online • AI Analyzing Sentiment: Positive</div>
                        </div>
                    </div>

                    <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {chatHistory.map((chat, i) => (
                            <div key={i} style={{ alignSelf: chat.sender === 'You' ? 'flex-end' : 'flex-start', maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: chat.sender === 'You' ? 'right' : 'left' }}>
                                    {chat.sender} <span style={{ marginLeft: 6 }}>{chat.time}</span>
                                </div>
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    borderRadius: '16px',
                                    background: chat.sender === 'You' ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                    color: chat.sender === 'You' ? '#fff' : 'var(--text-main)',
                                    borderTopRightRadius: chat.sender === 'You' ? 4 : 16,
                                    borderTopLeftRadius: chat.sender === 'You' ? 16 : 4
                                }}>
                                    {chat.text}
                                </div>
                            </div>
                        ))}
                    </div>

                    <form onSubmit={handleSend} style={{ padding: '1rem', borderTop: '1px solid var(--panel-border)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.5rem' }}>
                            <Plus size={20} />
                        </button>
                        <input
                            type="text"
                            value={msg}
                            onChange={(e) => setMsg(e.target.value)}
                            placeholder="Type your message... (AI can auto-reply)"
                            style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: '24px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}
                        />
                        <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem', borderRadius: '50%' }}>
                            <Send size={18} />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Chat;
