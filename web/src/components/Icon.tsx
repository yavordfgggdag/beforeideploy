// A small, consistent line-icon set (24×24, 1.7 stroke). Decorative unless `label` is given.
const P: Record<string, string> = {
  overview: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  sites: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 8.2h.01M9.5 8.2h.01',
  ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  activity: 'M3 12h4l3 7 4-14 3 7h4',
  plan: 'M4 7h16v12H4zM4 11h16M8 15h3',
  settings: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-4l-.5 2.5L9 7.5 7 7 5 11l2 1v0l-2 1 2 4 2-.5 1.5 1L11 20h4l.5-2.5 1.5-1 2 .5 2-4z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3.5 7.5h6l2 2h9v9h-17z',
  check: 'M5 12.5l4.2 4.2L19 7',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  x: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  globe: 'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z',
  shield: 'M12 3.5l7 2.8v5.2c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6.3z',
  archive: 'M4 5h16v4H4zM5.5 9v10h13V9M10 13h4',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  code: 'M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5',
  rocket: 'M12 3c3.5 2 5 5.5 5 9.5l-2.5 3h-5L7 12.5C7 8.5 8.5 5 12 3zM9.5 15.5L8 20l2.5-1.5M14.5 15.5L16 20l-2.5-1.5',
  send: 'M4 12l16-8-6 16-2-6z',
  stop: 'M7 7h10v10H7z',
  clock: 'M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM12 7.5V12l3 2',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
};
export function Icon({ name, size = 18, label }: { name: keyof typeof P | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={P[name] ?? P.sparkle} />
    </svg>
  );
}
