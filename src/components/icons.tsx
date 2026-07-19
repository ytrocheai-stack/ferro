interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
}

function base(props: IconProps) {
  return {
    width: props.size ?? 22,
    height: props.size ?? 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: props.strokeWidth ?? 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: props.className,
  }
}

export const IconDumbbell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 6.5 17.5 17.5" />
    <path d="M21 21l-1.5-1.5M3 3l1.5 1.5" />
    <path d="M18 22l4-4M2 6l4-4" />
    <path d="M3.5 8.5 8.5 3.5M15.5 20.5l5-5" />
  </svg>
)

export const IconHistory = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const IconList = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export const IconUser = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
)

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
)

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

export const IconChevronUp = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 15l7-7 7 7" />
  </svg>
)

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 9l7 7 7-7" />
  </svg>
)

export const IconDots = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </svg>
)

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

export const IconPencil = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1Z" />
    <path d="M14.5 6.5l3 3" />
  </svg>
)

export const IconTimer = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 2h4" />
    <circle cx="12" cy="14" r="8" />
    <path d="M12 14V9" />
  </svg>
)

export const IconTrophy = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 21h8M12 17v4" />
    <path d="M7 4h10v6a5 5 0 0 1-10 0V4Z" />
    <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
)

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 21h16" />
  </svg>
)

export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
)

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.5-4.5" />
  </svg>
)

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7Z" />
  </svg>
)

export const IconMinus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
)

export const IconFood = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 3v7a2 2 0 0 0 2 2v9" />
    <path d="M5 3v4M9 3v4" />
    <path d="M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" />
  </svg>
)

export const IconCalendar = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
)

export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
)

export const IconCamera = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h2.5L9 5h6l2.5 3H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
)

export const IconRuler = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="8.5" width="19" height="7" rx="1.5" transform="rotate(-20 12 12)" />
    <path d="M8 13.5l1-2.7M12 12l1-2.7M16 10.5l1-2.7" />
  </svg>
)

export const IconScale = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9h16" />
    <path d="M4 9v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
    <rect x="8" y="5" width="2.5" height="8" rx="1" />
    <rect x="13.5" y="5" width="2.5" height="8" rx="1" />
  </svg>
)

export const IconFlame = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3c1 3-4 5-4 10a4 4 0 0 0 8 0c0-2-1-3.5-2-4.5 0 1.5-1 2-2 2 1.5-2.5-1-5 0-7.5Z" />
  </svg>
)

export const IconRepeat = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9a5 5 0 0 1 5-5h8" />
    <path d="M14 1l3 3-3 3" />
    <path d="M20 15a5 5 0 0 1-5 5H7" />
    <path d="M10 23l-3-3 3-3" />
  </svg>
)

export const IconBarcode = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7v10M8 7v10M11 7v10M14 7v6M17 7v10M20 7v10" />
  </svg>
)

export const IconStar = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.5 6.8L12 17.6l-6.1 3.4 1.5-6.8-5.2-4.7 6.9-.7Z" />
  </svg>
)

export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
)

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)
