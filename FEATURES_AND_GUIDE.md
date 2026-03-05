# Final Table Poker Club — Features & Quick-Start Guide

---

## System Overview

Final Table Poker Club (FTPC) is a real-time poker room management system for tracking players, tables, buy-ins, waitlists, and financials. It includes an **Admin Dashboard**, a **TV Display**, a **Tablet Interface** for floor staff, and a **Public Mobile View** for players.

---

## High-Level Features

### 1. Player Check-In & Buy-In
- Register new or returning players with nickname, phone, and email
- Configurable door fee amounts (remembered across sessions)
- Automatic receipt generation with sequential numbering
- Assign players directly to a table seat or waitlist during check-in
- Duplicate player detection and conflict resolution
- "Keep Open" mode for rapid back-to-back check-ins

### 2. Table Management
- Create tables with customizable game type (NLH, PLO, BigO, Limit, Mixed, Custom)
- Set stakes, seat count, buy-in limits, and bomb pot frequency
- Toggle table visibility on TV and Public pages independently
- Hide/show tables from the admin view
- Break a table — bulk-move all players to another table
- Remove a table — with option to relocate players first

### 3. Seating & Waitlists
- Seat players at specific tables instantly
- Per-table waitlists with automatic position ordering
- "Seat Next" button to pull the next waitlisted player into an open seat
- Players can be seated at one table and waitlisted at others simultaneously
- Called-in players tracked separately until buy-in is collected
- Drag & drop players between tables, seats, and waitlists

### 4. Player Movement
- **Drag & Drop** — click-hold a player name and drag to any table
- **Quick Move Buttons** — hover over a player to see shortcut buttons for top tables
- **Actions Menu** — right-click or use the dropdown to move, remove, or waitlist a player
- **Bulk Move** — move multiple players at once between tables
- **Bulk Bust-Out** — remove multiple players from a table simultaneously

### 5. Refunds
- Process full or partial refunds against a player's check-in
- Refund receipts generated automatically
- Refund reason tracking for audit trail
- Ledger entries updated in real time

### 6. Financial Reporting
- **Shift Report** — door fees and refunds for a custom time range
- **Club Day Report** — full-day financial summary
- **End-of-Shift Report** — detailed breakdown with close-day option
- **Year-End Reports** — annual summaries across all club days
- **CSV Export** — download report data as spreadsheet
- **Receipt Printing** — formatted for 80mm thermal receipt printers
- **Close Day & Start New Day** — generate final report and auto-reset in one step

### 7. Cash Reconciliation
- Record physical cash count at any time
- Compare counted cash against expected totals (door fees minus refunds)
- Option to close day and start new day after reconciliation

### 8. Multi-Screen Display

| Route | Purpose | Auth Required |
|-------|---------|---------------|
| `/admin` | Full management dashboard | Yes (login) |
| `/tv` | Large-screen TV display for the room | No |
| `/tablet` | Floor staff tablet for player moves | No |
| `/public` | Player-facing mobile view | No |
| `/confirm` | Public signup confirmation page | No |

- **TV Display** — shows all active tables, seated players, waitlists, and game info in a large-format layout optimized for wall-mounted screens
- **Tablet View** — simplified interface for floor staff to move players between tables without full admin access
- **Public Mobile View** — players can see table availability, waitlist status, and sign up for tables from their phones
- **QR Code** — generate and display a QR code linking to the public page

### 9. SMS Notifications
- Send automatic SMS to players on check-in confirmation
- Configurable via Settings → SMS Settings
- Uses TextBelt API for delivery
- Test SMS functionality to verify setup

### 10. Public Pre-Sign-Up
- Players can sign up for tables from the public page on their phone
- Admin receives pending signups and can approve/reject
- Approved players are added to waitlist or seated automatically
- Confirmation SMS sent on approval

### 11. Persistent Tables
- Tables that carry over across day resets
- Waitlists preserved when day is reset
- Public sign-up enabled per table
- Ideal for regular recurring games

### 12. Search & Filtering
- Search players or tables by name/number (Ctrl+K)
- Quick filter buttons: **All**, **Empty**, **Full**, **Waitlist**
- Search highlights matching text across all table cards

### 13. Player Management
- View and edit all player profiles
- Search by nickname, name, or phone
- Purge inactive players (90+ days)
- Recover recently removed players (last 1 hour)

### 14. Day Management
- Automatic new day creation on first login
- Auto-reset at 9:00 AM if no active players
- Manual reset via Settings → Reset Day
- Stale day warnings when a day has been running too long

### 15. Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Open Buy-In / Check-In modal |
| `Ctrl+R` | Open Refund modal |
| `Ctrl+T` | Add a new table |
| `Ctrl+K` | Focus the search bar |

---

## Quick How-To Guide

### Starting a New Session
1. Log in at `/admin` with your credentials
2. The system automatically creates a new Club Day if none is active
3. Default tables are created (or persistent tables are restored)
4. You're ready to accept players

### Checking In a Player
1. Click **"Buy-in Player"** (or press `Ctrl+B`)
2. Type the player's nickname — existing players will appear as suggestions
3. Select an existing player or create a new one (enter name, phone, email)
4. Set the **door fee amount** (quick-select buttons for common amounts)
5. Choose a **table** to seat them at, or select a waitlist
6. Click **"Check In"**
7. A receipt is generated automatically

### Adding a Table
1. Click **"Add Table"** (or press `Ctrl+T`)
2. Set the table number, game type, stakes, and seat count
3. Configure buy-in limits and bomb pot count
4. Click **"Create Table"**

### Moving a Player
- **Drag & Drop:** Click and hold on a player name → drag to another table
- **Quick Buttons:** Hover over a player → click a table shortcut (e.g., T8, T10)
- **Actions Menu:** Click the player's action dropdown → "Move to Table X"

### Processing a Refund
1. Click **"Refund"** (or press `Ctrl+R`)
2. Search for the player by nickname
3. Select their active check-in
4. Enter refund amount and reason
5. Click **"Process Refund"**

### Breaking a Table
1. Open **Settings → Table Management** (or use the ⚙️ Manage button)
2. Select the table to break
3. Choose a destination table for all players
4. Confirm — all players are moved and the source table is closed

### Running a Report
1. Open **Settings → Reports**
2. Choose report type:
   - **Shift Report** — set start/end time for your shift
   - **Club Day Report** — full day totals
   - **Year-End** — annual summary
3. Click **"Generate Report"** to print, or switch to **CSV** to download
4. Optionally click **"Close Day & Start New Day"** to end the session

### Setting Up SMS Notifications
1. Open **Settings → SMS Settings**
2. Enter your **TextBelt API key**
3. Enable **SMS Features**
4. Use **"Send Test SMS"** to verify delivery
5. SMS will be sent automatically on player check-in

### Displaying on TV
1. Click **📺 TV** in the header (opens in new window)
2. Set the browser to full-screen (F11)
3. The display auto-refreshes with live table data
4. Toggle which tables appear on TV using the **"Cast"** button on each table card

### Sharing the Public Page
1. Click **📱 Mobile View** to open the public page
2. Or open **Settings → QR Code** to display a scannable QR code
3. Players can view tables, availability, and sign up from their phones

### Ending the Day
**Recommended method:**
1. Open **Settings → Reports**
2. Generate an **End-of-Shift Report**
3. Click **"Close Day & Start New Day"**
4. The report prints, the day closes, and a fresh day starts automatically

**Alternative methods:**
- **Cash Reconciliation:** Settings → Cash Reconciliation → enter cash count → check "Close day" → submit
- **Manual Reset:** Settings → Reset Day → confirm
- **Auto-Reset:** System resets at 9:00 AM if no players are active

---

## Architecture at a Glance

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Styling | Custom CSS with CSS variables (dark theme) |
| Backend | AWS Amplify (AppSync GraphQL + DynamoDB) |
| Auth | Amazon Cognito (user pool) |
| SMS | TextBelt API via AppSync Lambda |
| Hosting | AWS Amplify Console |
| Real-time | Polling + BroadcastChannel (cross-tab sync) |

---

*Designed by Humanity MSP, Josh McKinney — 360-721-7359*
