import { useEffect, useRef, useState, type ReactNode } from 'react';
import api, { errMsg } from '../api';
import { useAuth } from '../auth';
import { notifyBookingsChanged } from '../utils';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const ADMIN_SUGGESTIONS = [
  'Show pending bookings',
  'Pending bookings today',
  'List all facilities',
  'Campus stats',
  'Add new facility',
];

const STUDENT_SUGGESTIONS = [
  'Suggest a facility for 50 people',
  'I need a lab tomorrow',
  'Is the auditorium free at 3 PM?',
  'Show my upcoming bookings',
  'What facilities can I book?',
];

function renderText(text: string, onAction?: (text: string) => void): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => {
    if (i % 2 === 1) {
      if (/^FAC\d{3,}$/i.test(part) && onAction) {
        return (
          <strong
            key={i}
            className="clickable-tag"
            title={`Click to check ${part}`}
            onClick={() => onAction(`status of ${part}`)}
          >
            {part}
          </strong>
        );
      }
      return <strong key={i}>{part}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function extractActions(content: string): { label: string; action: string; type: 'approve' | 'reject' | 'primary' }[] {
  const actions: { label: string; action: string; type: 'approve' | 'reject' | 'primary' }[] = [];

  // Do not extract from help texts, greetings, error or completed messages
  if (
    content.includes('what you can ask me') ||
    content.includes('Could not process') ||
    content.includes('was not found') ||
    content.includes('has been') ||
    content.includes('already') ||
    content.includes('cleared that request')
  ) {
    return actions;
  }

  // Only extract approval actions when real pending bookings are listed
  if (content.includes('Pending Bookings') || content.includes('Pending requests:')) {
    const ids = Array.from(new Set(Array.from(content.matchAll(/\bFAC\d{3,}\b/gi)).map((m) => m[0].toUpperCase())));
    for (const id of ids.slice(0, 4)) {
      actions.push({ label: `Approve ${id}`, action: `Approve ${id}`, type: 'approve' });
      actions.push({ label: `Reject ${id}`, action: `Reject ${id}`, type: 'reject' });
    }
  }

  // Confirmation buttons for booking / cancellation
  if (/Shall I confirm the booking\?/i.test(content) || /Do you want to cancel/i.test(content)) {
    actions.push({ label: 'Yes, Confirm', action: 'yes', type: 'approve' });
    actions.push({ label: 'No, Cancel', action: 'no', type: 'reject' });
  }

  // Suggestion quick booking button
  const bookSuggest = content.match(/Book\s+([A-Za-z0-9 ]+?)\s+tomorrow/i);
  if (bookSuggest && !content.includes('Pending Bookings')) {
    actions.push({ label: `Book ${bookSuggest[1].trim()}`, action: `Book ${bookSuggest[1].trim()} tomorrow 2 PM to 4 PM`, type: 'primary' });
  }

  return actions;
}

export default function ChatWidget() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const defaultGreeting: Msg = {
    role: 'assistant',
    content: isAdmin
      ? `Hello Administrator! 🛡️ I am your Campus Admin Assistant.\n\nYou can:\n• View & decide pending bookings: "Show pending bookings", "Approve <ID>"\n• Manage facilities: "List all facilities", "Add a facility", "Deactivate facility ..."\n• System reports: "Campus stats"`
      : `Hi! 🎓 I'm your Campus Assistant.\n\nTell me what you need, e.g.:\n• "I need a computer lab tomorrow from 2 to 4 PM"\n• "Suggest a facility for 50 people with projector"\n• "Show my bookings"`,
  };

  const suggestions = isAdmin ? ADMIN_SUGGESTIONS : STUDENT_SUGGESTIONS;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([defaultGreeting]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Update greeting when role changes or history is empty
  useEffect(() => {
    if (messages.length <= 1) {
      setMessages([defaultGreeting]);
    }
  }, [user?.role]);

  useEffect(() => {
    if (!open || loaded) return;
    api
      .get<{ messages: Msg[] }>('/chat/history')
      .then((r) => {
        if (r.data.messages.length) setMessages(r.data.messages);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; bookingChanged: boolean }>('/chat', { message });
      setMessages((m) => [...m, { role: 'assistant', content: r.data.reply }]);
      if (r.data.bookingChanged) notifyBookingsChanged();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Sorry, something went wrong: ${errMsg(e)}` }]);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    try {
      await api.post('/chat/reset');
    } catch {
      /* ignore */
    }
    setMessages([defaultGreeting]);
  };

  return (
    <>
      {open && (
        <div className="chat-panel" role="dialog" aria-label={isAdmin ? 'Admin Assistant' : 'Campus Assistant'}>
          <div className="chat-head">
            <div className="chat-title">
              <strong>{isAdmin ? 'Admin Assistant 🛡️' : 'Campus Assistant 🎓'}</strong>
              <span className="chat-badge">{isAdmin ? 'Admin' : 'Student'}</span>
            </div>
            <span>
              <button className="icon-btn" onClick={reset} title="New conversation">↺</button>
              <button className="icon-btn" onClick={() => setOpen(false)} title="Close">✕</button>
            </span>
          </div>
          <div className="chat-body">
            {messages.map((m, i) => {
              const actions = m.role === 'assistant' ? extractActions(m.content) : [];
              return (
                <div key={i} className={`bubble ${m.role}`}>
                  <div>{renderText(m.content, send)}</div>
                  {actions.length > 0 && (
                    <div className="action-chips">
                      {actions.map((act, actIdx) => (
                        <button
                          key={actIdx}
                          className={`action-chip ${act.type}`}
                          disabled={busy}
                          onClick={() => send(act.action)}
                        >
                          {act.type === 'approve' && '✅ '}
                          {act.type === 'reject' && '❌ '}
                          {act.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {messages.length <= 1 && (
              <div className="chips">
                {suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)} disabled={busy}>{s}</button>
                ))}
              </div>
            )}
            {busy && <div className="bubble assistant typing">Thinking…</div>}
            <div ref={endRef} />
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isAdmin ? 'Ask e.g. "Pending bookings", "Approve FAC1001", "Add facility"...' : 'Ask e.g. "Suggest a facility for 50", "Book lab tomorrow"...'}
              maxLength={1000}
              autoFocus
            />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>
      )}
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label="Open booking assistant">
        {open ? '✕' : isAdmin ? '🛡️' : '💬'}
      </button>
    </>
  );
}
