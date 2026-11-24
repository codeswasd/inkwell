import { navigate } from '../router.js';

export function Avatar({ user, size = 28, ring = false, title }) {
  if (!user) return null;
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <span
      className={`avatar${ring ? ' avatar-ring' : ''}`}
      style={{ '--c': user.color, width: size, height: size, fontSize: Math.round(size * 0.38) }}
      title={title ?? `${user.name} (${user.email})`}
    >
      {initials}
    </span>
  );
}

export function Wordmark({ asLink = false }) {
  const mark = (
    <>
      <svg className="wordmark-drop" viewBox="0 0 20 26" width="15" height="20" aria-hidden>
        <path d="M10 1C10 1 2 11.5 2 17a8 8 0 0 0 16 0C18 11.5 10 1 10 1z" />
      </svg>
      <span>Inkwell</span>
    </>
  );
  return asLink ? (
    <a className="wordmark" href="#/" onClick={(e) => { e.preventDefault(); navigate('#/'); }}>{mark}</a>
  ) : (
    <span className="wordmark">{mark}</span>
  );
}

export function UserMenu({ user, onSignOut }) {
  return (
    <div className="usermenu">
      <Avatar user={user} size={30} />
      <span className="usermenu-name">{user.name}</span>
      <button className="text-btn" onClick={onSignOut}>Sign out</button>
    </div>
  );
}

export function timeAgo(isoString) {
  const t = new Date(isoString).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };

export function RoleTag({ role }) {
  return <span className={`role role-${role}`}>{ROLE_LABEL[role]}</span>;
}

export function formatWhen(isoString) {
  const d = new Date(isoString);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
