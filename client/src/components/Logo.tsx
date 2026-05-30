export function Logo({ size = 28 }: { size?: number }) {
  // Hermes mark: a winged "H" — geometric, single accent, works small.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Hermes"
      data-testid="img-logo"
    >
      {/* H uprights */}
      <path d="M11 9 L11 23" />
      <path d="M21 9 L21 23" />
      {/* crossbar */}
      <path d="M11 16 L21 16" />
      {/* wings */}
      <path d="M11 12 L5 10" />
      <path d="M11 15 L6 14" />
      <path d="M21 12 L27 10" />
      <path d="M21 15 L26 14" />
    </svg>
  );
}
