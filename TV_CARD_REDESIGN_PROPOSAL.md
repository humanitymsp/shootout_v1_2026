# TV Card UX Redesign Proposal

## Core UX Principles

1. **Distance Readability** - TV displays are viewed from 10-15 feet away
2. **Information Hierarchy** - Most important info first (table #, game, players)
3. **Scanability** - Quick visual scanning across multiple cards
4. **Predictable Layout** - Consistent card height/structure

## Recommended Design: "Compact Header + Priority Content"

### Layout Structure

```
┌─────────────────────────────────────────┐
│ T1 • NL $1/$2 • 7/9 💺 • 💣2 • [OPEN]  │  ← Compact single-line header
│ ═══════════════════════════════════════ │
│                                          │
│              SEATED                      │  ← Section title
│                                          │
│            Player Name 1                 │
│            Player Name 2                 │  ← Large, readable names
│            Player Name 3                 │
│            Player Name 4                 │
│            Player Name 5                 │
│            Player Name 6                 │
│            Player Name 7                 │
│                                          │
│            WAITLIST (3)                  │  ← Show count
│                                          │
│            Player Name 8                 │
│            Player Name 9                 │
│            Player Name 10                │
│                                          │
│         💵 $40-$400 Buy-in              │  ← Footer info
└─────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Ultra-Compact Header (Single Line)
- Combine all meta info: T# • Game • Seats • Bombs • Status
- Uses icons/emojis for visual scanning
- Frees up 40-50% more vertical space

### 2. Maximum Space for Names
- 85% of card devoted to player names
- Larger font (1rem - 1.2rem)
- More padding/line-height for readability

### 3. Smart Scrolling
- If names exceed space: smooth auto-scroll
- OR: Fixed height with custom scrollbar
- Always show all information

### 4. Visual Hierarchy
```
Priority 1: Player Names (85% of space)
Priority 2: Table # and Game Type (20% of space)
Priority 3: Status/Indicators (15% of space)
Priority 4: Buy-in (10% of space)
```

## Alternative: Horizontal Split (For Wider Displays)

```
┌────────────────────────────┬──────────────────┐
│ Table 1 • NL $1/$2         │                  │
│ 💣2 • [OPEN]               │                  │
│                            │                  │
│ SEATED (7/9)               │ WAITLIST (3)     │
│                            │                  │
│ • Player1                  │ • Player8        │
│ • Player2                  │ • Player9        │
│ • Player3                  │ • Player10       │
│ • Player4                  │                  │
│ • Player5                  │                  │
│ • Player6                  │                  │
│ • Player7                  │                  │
│                            │                  │
│ $40-$400 Buy-in            │                  │
└────────────────────────────┴──────────────────┘
```

**Use when:** Screen width > 1920px, 3 columns or fewer

## Implementation Recommendations

### Typography
- **Table #:** 1.4rem, bold, all caps
- **Player Names:** 1rem - 1.2rem, medium weight
- **Section Titles:** 0.9rem, uppercase, tracked
- **Meta Info:** 0.75rem - 0.85rem

### Spacing
- **Card Padding:** 1.2rem - 1.5rem
- **Line Height:** 1.5 for names
- **Section Gap:** 0.8rem between seated/waitlist
- **Name Gap:** 0.4rem between individual names

### Colors & Contrast
- **Background:** Dark with 10% transparency
- **Text:** 95% white (high contrast)
- **Sections:** Subtle borders/backgrounds
- **Status:** Color-coded (Green=Open, Yellow=Busy, Red=Full)

### Responsive Breakpoints
- **Small (< 1440px):** Compact single column, font 0.9rem
- **Medium (1441-1920px):** Standard single column, font 1rem
- **Large (1921-2560px):** Optional 2-column names, font 1.1rem
- **XL (> 2560px):** Horizontal split layout, font 1.2rem

## Success Metrics

✓ All player names visible without scrolling (or clean scroll)
✓ Readable from 12+ feet away
✓ Quick visual scanning (< 2 seconds per card)
✓ Consistent card heights (±20px variance)
✓ Professional, modern appearance

## Next Steps

1. Implement compact header design
2. Increase player name font to 1rem minimum
3. Add auto-scroll for overflow (optional)
4. Test on actual TV display from 12 feet
5. User feedback session

