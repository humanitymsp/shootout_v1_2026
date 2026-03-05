import './Logo.css';

export default function Logo() {
  return (
    <div className="logo-container">
      <svg
        className="logo-svg"
        viewBox="0 0 400 200"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Card backs (left and right) */}
        <g className="card-back-left">
          <rect
            x="50"
            y="20"
            width="80"
            height="110"
            rx="8"
            ry="8"
            fill="#9ca3af"
            opacity="0.9"
            transform="rotate(-15 90 75)"
          />
          <rect
            x="52"
            y="22"
            width="76"
            height="106"
            rx="6"
            ry="6"
            fill="#d1d5db"
            opacity="0.6"
            transform="rotate(-15 90 75)"
          />
        </g>

        <g className="card-back-right">
          <rect
            x="270"
            y="20"
            width="80"
            height="110"
            rx="8"
            ry="8"
            fill="#9ca3af"
            opacity="0.9"
            transform="rotate(15 310 75)"
          />
          <rect
            x="272"
            y="22"
            width="76"
            height="106"
            rx="6"
            ry="6"
            fill="#d1d5db"
            opacity="0.6"
            transform="rotate(15 310 75)"
          />
        </g>

        {/* Central card with spade */}
        <g className="card-front">
          <rect
            x="150"
            y="10"
            width="100"
            height="130"
            rx="10"
            ry="10"
            fill="#1e3a8a"
            stroke="#fbbf24"
            strokeWidth="2"
          />
          <rect
            x="152"
            y="12"
            width="96"
            height="126"
            rx="8"
            ry="8"
            fill="#1e40af"
          />
          
          {/* Gold Spade Symbol ♠ - Classic shape */}
          <g className="spade-symbol" transform="translate(200, 75)">
            {/* Main spade body - point at top, curves outward, comes to bottom */}
            <path
              d="M 0 -45
                 C 0 -45, -8 -30, -25 -10
                 C -35 2, -30 25, -15 25
                 C -5 25, 0 15, 0 15
                 C 0 15, 5 25, 15 25
                 C 30 25, 35 2, 25 -10
                 C 8 -30, 0 -45, 0 -45
                 Z"
              fill="#fbbf24"
            />
            {/* Stem at bottom */}
            <path
              d="M -8 15
                 L -15 45
                 L 15 45
                 L 8 15
                 Z"
              fill="#fbbf24"
            />
          </g>
        </g>

        {/* FINAL TABLE text */}
        <text
          x="200"
          y="160"
          textAnchor="middle"
          className="logo-text-main"
          fontSize="36"
          fontFamily="Georgia, serif"
          fill="#f5f5dc"
          fontWeight="700"
          letterSpacing="2"
        >
          FINAL TABLE
        </text>

        {/* POKER CLUB text */}
        <text
          x="200"
          y="185"
          textAnchor="middle"
          className="logo-text-sub"
          fontSize="20"
          fontFamily="Georgia, serif"
          fill="#f5f5dc"
          fontWeight="600"
          letterSpacing="3"
        >
          POKER CLUB
        </text>
      </svg>
    </div>
  );
}
