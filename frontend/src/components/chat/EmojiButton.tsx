import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Self-contained emoji picker button for the Omni-Chat composer.
 *
 * Renders the trigger button + a popover grid of common emoji organised
 * into a few categories. No external dependency — a curated set covers the
 * everyday needs of a sales/support chat. Picking an emoji calls `onPick`
 * (which inserts it at the caret in the composer) and KEEPS the popover
 * open so the agent can add several in a row, just like LINE OA.
 *
 * Wrapping the button + popover in one ref means clicking the trigger never
 * triggers the outside-click close (the button lives inside the ref).
 */

const EMOJI_CATEGORIES: { key: string; icon: string; emojis: string[] }[] = [
    {
        key: 'smileys',
        icon: '😊',
        emojis: [
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
            '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜',
            '🤪', '🤗', '🤩', '🥳', '😎', '🤓', '🧐', '🤔', '🤭', '🤫',
            '😏', '😐', '😑', '😶', '🙄', '😬', '😯', '😴', '🤤', '😪',
            '😉', '🥺', '😢', '😭', '😤', '😠', '😡', '😞', '😔', '😳',
            '🥵', '🥶', '😱', '😨', '😰', '😅', '🤥', '🤐', '🤢', '🤮',
            '🤧', '😷', '🤒', '🤕', '🥴', '😵', '🤯', '🥱', '😬', '🙃',
        ],
    },
    {
        key: 'gestures',
        icon: '👍',
        emojis: [
            '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '👐',
            '🤲', '🙏', '💪', '🤝', '👋', '🤚', '✋', '🖐️', '👆', '👇',
            '👈', '👉', '☝️', '✊', '👊', '🫶', '💁', '🙆', '🙅', '🙋',
            '🤷', '🤦', '🧑‍💼', '👩‍💼', '👨‍💼', '🧑‍🔧', '🦾', '👀', '🧠', '👅',
        ],
    },
    {
        key: 'hearts',
        icon: '❤️',
        emojis: [
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
            '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌',
            '✨', '🔥', '⭐', '🌟', '💫', '💯', '💢', '💥', '💦', '🎉',
            '🎊', '🎁', '🎈', '🌸', '🌺', '🌼', '🌷', '🌹', '🍀', '☀️',
        ],
    },
    {
        key: 'commerce',
        icon: '📦',
        emojis: [
            '📦', '🛒', '🛍️', '💰', '💵', '💳', '🧾', '🏷️', '📈', '📉',
            '📊', '📋', '📝', '📄', '✏️', '🖊️', '🔧', '🔩', '⚙️', '🛠️',
            '🔨', '⛏️', '🧰', '🔗', '📌', '📎', '✂️', '📐', '📏', '🧲',
            '⚡', '🔋', '💡', '🔌', '🧪', '⛓️', '🪚', '🪛', '🔦', '🧱',
        ],
    },
    {
        key: 'shipping',
        icon: '🚚',
        emojis: [
            '🚚', '🚛', '🚐', '🛵', '🏍️', '✈️', '🚀', '🚢', '⛟', '📮',
            '⏱️', '⏰', '📅', '🗓️', '⌛', '⏳', '🕐', '📍', '🗺️', '🧭',
            '🏠', '🏢', '🏭', '🏬', '📞', '☎️', '📱', '📲', '💬', '📨',
        ],
    },
    {
        key: 'symbols',
        icon: '✅',
        emojis: [
            '✅', '☑️', '✔️', '❌', '⭕', '🚫', '⚠️', '❗', '❓', '💯',
            '🔔', '🔕', '➕', '➖', '✖️', '➗', '🆗', '🆕', '🔥', '♻️',
            '🔄', '🔁', '▶️', '⏸️', '⏹️', '🔼', '🔽', '⬆️', '⬇️', '⬅️',
            '➡️', '↩️', '🔝', '🆙', '🈵', '🉐', '©️', '®️', '™️', '🔆',
        ],
    },
];

export default function EmojiButton({
    onPick,
    disabled,
}: {
    onPick: (emoji: string) => void;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [cat, setCat] = useState(0);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onDown(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={wrapRef} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((v) => !v)}
                title="แทรกอิโมจิ"
                className={cn(
                    'grid place-items-center w-8 h-8 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed',
                    open && 'text-indigo-600 bg-indigo-50',
                )}
            >
                <Smile size={18} />
            </button>

            {open && (
                <div className="absolute bottom-full mb-2 left-0 z-30 w-[296px] rounded-xl border border-neutral-200 bg-white shadow-xl overflow-hidden">
                    {/* Category tabs */}
                    <div className="flex border-b border-neutral-100 bg-neutral-50">
                        {EMOJI_CATEGORIES.map((c, i) => (
                            <button
                                key={c.key}
                                type="button"
                                onClick={() => setCat(i)}
                                className={cn(
                                    'flex-1 py-1.5 text-lg leading-none transition',
                                    i === cat ? 'bg-white shadow-[inset_0_-2px_0_0_#6366f1]' : 'hover:bg-white/60 opacity-70',
                                )}
                            >
                                {c.icon}
                            </button>
                        ))}
                    </div>
                    {/* Emoji grid */}
                    <div className="p-2 grid grid-cols-8 gap-0.5 max-h-[208px] overflow-y-auto">
                        {EMOJI_CATEGORIES[cat].emojis.map((e, i) => (
                            <button
                                key={`${e}-${i}`}
                                type="button"
                                onClick={() => onPick(e)}
                                className="text-xl leading-none p-1 rounded hover:bg-indigo-50 active:scale-90 transition"
                                title={e}
                            >
                                {e}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
