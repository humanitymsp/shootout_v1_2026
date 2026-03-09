import type { CardCode } from '../lib/highHand';
import './PlayingCard.css';

const RANK_DISPLAY: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
  '7': '7', '8': '8', '9': '9', 'T': '10',
  'J': 'J', 'Q': 'Q', 'K': 'K', 'A': 'A',
};

const SUIT_SYMBOL: Record<string, string> = {
  s: '♠', h: '♥', d: '♦', c: '♣',
};

const SUIT_COLOR: Record<string, string> = {
  s: '#1e293b', h: '#dc2626', d: '#2563eb', c: '#15803d',
};

// Lighter suit colors for picker buttons on dark backgrounds
const SUIT_COLOR_LIGHT: Record<string, string> = {
  s: '#cbd5e1', h: '#f87171', d: '#60a5fa', c: '#4ade80',
};

interface PlayingCardProps {
  card: CardCode;
  size?: 'sm' | 'md' | 'lg' | 'tv';
}

export default function PlayingCard({ card, size = 'md' }: PlayingCardProps) {
  if (!card || card.length < 2) return null;
  const rank = card[0];
  const suit = card[1];
  const rankDisplay = RANK_DISPLAY[rank] || rank;
  const suitSymbol = SUIT_SYMBOL[suit] || '';
  const color = SUIT_COLOR[suit] || '#000';

  return (
    <div className={`playing-card playing-card-${size}`} style={{ color }}>
      <span className="playing-card-rank">{rankDisplay}</span>
      <span className="playing-card-suit">{suitSymbol}</span>
    </div>
  );
}

// Card picker grid for admin
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUITS = ['s', 'h', 'd', 'c'];

interface CardPickerProps {
  selected: CardCode[];
  onChange: (cards: CardCode[]) => void;
  maxCards?: number;
}

export function CardPicker({ selected, onChange, maxCards = 5 }: CardPickerProps) {
  const toggle = (code: CardCode) => {
    if (selected.includes(code)) {
      onChange(selected.filter(c => c !== code));
    } else if (selected.length < maxCards) {
      onChange([...selected, code]);
    }
  };

  const clear = () => onChange([]);

  return (
    <div className="card-picker">
      <div className="card-picker-header">
        <span className="card-picker-label">
          Cards ({selected.length}/{maxCards})
        </span>
        {selected.length > 0 && (
          <button type="button" className="card-picker-clear" onClick={clear}>Clear</button>
        )}
      </div>
      {selected.length > 0 && (
        <div className="card-picker-selected">
          {selected.map(c => (
            <PlayingCard key={c} card={c} size="sm" />
          ))}
        </div>
      )}
      <div className="card-picker-grid">
        {SUITS.map(suit => (
          <div key={suit} className="card-picker-suit-row">
            <span className="card-picker-suit-label" style={{ color: SUIT_COLOR_LIGHT[suit] }}>
              {SUIT_SYMBOL[suit]}
            </span>
            {RANKS.map(rank => {
              const code = `${rank}${suit}`;
              const isSelected = selected.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className={`card-picker-btn ${isSelected ? 'active' : ''}`}
                  style={isSelected ? { background: SUIT_COLOR_LIGHT[suit], color: '#000' } : { color: SUIT_COLOR_LIGHT[suit] }}
                  onClick={() => toggle(code)}
                  disabled={!isSelected && selected.length >= maxCards}
                >
                  {RANK_DISPLAY[rank]}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
