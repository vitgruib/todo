import React from 'react';

interface GuideScreenProps {
    version: string;
    onClose: () => void;
}

const GUIDE_ITEMS: { icon: string; title: string; body: string }[] = [
    {
        icon: '⌨️',
        title: 'Add a task',
        body: 'Type it and press Enter. Pick “Short run” if it has a deadline, or “Long term” if it doesn’t.',
    },
    {
        icon: '💤',
        title: 'Change when it’s due',
        body: 'Hover a task and tap +1h, +2h, +3h, +1d, or +2d. Or open the ⋮ menu and tap 📅 to pick an exact time. It changes right away.',
    },
    {
        icon: '⏰',
        title: 'When a task is due',
        body: 'A reminder window pops up. Close it and it comes back later until you do the task. Set how long it waits under Settings → Snooze duration.',
    },
    {
        icon: '🔴',
        title: 'Mark something urgent',
        body: 'Urgent tasks turn red and jump to the top. If you push the deadline back, the urgent flag comes off — something you keep delaying isn’t really urgent.',
    },
    {
        icon: '⏳',
        title: 'Putting things off',
        body: 'Each time you push a task back, it turns a little more orange — so you can see what keeps slipping.',
    },
    {
        icon: '↩️',
        title: 'Made a mistake?',
        body: 'If you delete or finish a task, or clear the archive, a small bar shows up with an Undo button.',
    },
    {
        icon: '☁️',
        title: 'Using two computers?',
        body: 'Turn on “Sync across my computers” in Settings. Changes take a few seconds to travel, so click on one computer and give it about 10 seconds before clicking on the other.',
    },
];

export const GuideScreen: React.FC<GuideScreenProps> = ({ version, onClose }) => {
    return (
        <div
            className="guide-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="How Toto Simple works"
        >
            <div className="guide-card">
                <div className="guide-header">
                    <div>
                        <div className="guide-eyebrow">Welcome · v{version}</div>
                        <h2 className="guide-title">How to use Toto Simple</h2>
                    </div>
                    <button
                        type="button"
                        className="guide-close"
                        onClick={onClose}
                        aria-label="Close guide"
                    >
                        ✕
                    </button>
                </div>

                <div className="guide-grid">
                    {GUIDE_ITEMS.map((item) => (
                        <div key={item.title} className="guide-item">
                            <span className="guide-item-icon" aria-hidden="true">
                                {item.icon}
                            </span>
                            <div>
                                <div className="guide-item-title">{item.title}</div>
                                <p className="guide-item-body">{item.body}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <button type="button" className="guide-got-it" onClick={onClose}>
                    Got it
                </button>
            </div>
        </div>
    );
};
