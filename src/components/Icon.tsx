const paths = {
  week: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM3 9h18M8 2v4M16 2v4M7 13h3v3H7zM14 13h3M14 17h3',
  calendar:
    'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2ZM3 9h18M8 2v4M16 2v4M7 13h1M12 13h1M17 13h1M7 17h1M12 17h1M17 17h1',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  office: 'M5 21V3h14v18M3 21h18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-5h4v5',
  remote: 'm3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7',
  vacation: 'M4 8h16v13H4zM9 8V4h6v4M8 8v13M16 8v13',
  sick: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  holiday:
    'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  clear: 'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6',
  left: 'm14 6-6 6 6 6',
  right: 'm10 6 6 6-6 6',
  arrow: 'M7 17 17 7M7 7h10v10',
  undo: 'M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
