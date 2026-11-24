const PATHS = {
  back: <path d="M12 4l-6 6 6 6" />,
  comment: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" />,
  history: <><path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" /><path d="M3 3.5v3h3" /><path d="M10 6.5V10l2.5 1.5" /></>,
  keyboard: <><rect x="2.5" y="5" width="15" height="10" rx="1.5" /><path d="M5.5 8h1M9.5 8h1M13.5 8h1M6 12h8" /></>,
};

export function Icon({ name, size = 16 }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}
