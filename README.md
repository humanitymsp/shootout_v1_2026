# Final Table Poker Club - Game Waitlist System

A production-ready, responsive poker club table management system built with AWS Amplify Gen 2, React, and TypeScript.

## Features

- **Admin UI**: Full-featured admin interface for managing players, tables, waitlists, and door fees
- **TV Dashboard**: Public read-only view optimized for large screens and Chrome casting
- **Real-time Updates**: Instant synchronization across all devices using AppSync subscriptions
- **Door Fee Management**: Track door fees (cash only) with receipt generation
- **Table Management**: Manage up to 20 tables with seating and waitlist functionality
- **Reports**: Shift settlement and ClubDay reports optimized for 80mm receipt printers
- **Cash Reconciliation**: Track counted cash vs system totals
- **Audit Logging**: Complete audit trail of all admin actions

## Important Notes

### Pagination & Player Counting ⚠️ CRITICAL
**Player counting relies on proper pagination support.** The GraphQL client must handle pagination correctly to ensure accurate player counts, especially when tables have more than 6 players.

**DO NOT modify pagination logic without reading:** [`docs/PAGINATION_CRITICAL_FIX.md`](docs/PAGINATION_CRITICAL_FIX.md)

Key points:
- All player-fetching functions use `limit: 1000` to ensure all players are fetched
- Pagination is handled recursively to fetch all pages
- Removing or reducing limits will break player counting after ~6-100 players
- This affects Admin, TV, Tablet, and Public views

### Door Fee Customization ⚠️
**The default door fee is $20**, but admins can change this to any amount on special occasions. 

In the check-in modal, the door fee dropdown includes:
- **$20** (default)
- $10
- $25
- **Custom** (allows entering any amount)

When selecting "Custom", admins can enter any dollar amount. This flexibility allows the club to adjust door fees for special events, promotions, or different player tiers without code changes.

### Compliance
- **NO wagering/pot/rake logic** - This system only tracks door/seat fees
- **Cash only** - All door fees are tracked as cash payments
- **TV view shows counts only** - No player names, phone numbers, or IDs displayed publicly

## Prerequisites

- Node.js 18+ and npm
- AWS Account
- AWS Amplify CLI (Gen 2)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure AWS Amplify

```bash
npx ampx sandbox
```

This will:
- Create AWS resources (DynamoDB, AppSync, Lambda, Cognito)
- Generate `amplify_outputs.json` with configuration
- Start a local development sandbox

### 3. Create Admin User

After the sandbox starts, create an admin user in AWS Cognito:
1. Go to AWS Console → Cognito → User Pools
2. Find your user pool
3. Create a user with email/password

### 4. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Deployment to AWS Amplify Hosting

### Option 1: Amplify Gen 2 Pipeline (Recommended)

1. Initialize Amplify app:
```bash
npx ampx pipeline-deploy --branch main --app-id YOUR_APP_ID
```

2. Connect your repository to Amplify Console
3. Amplify will automatically build and deploy on push

### Option 2: Manual Build & Deploy

1. Build the application:
```bash
npm run build
```

2. The `dist` folder contains the static files

3. Deploy via Amplify Console:
   - Create a new app in AWS Amplify Console
   - Choose "Deploy without Git provider"
   - Upload the `dist` folder contents as a ZIP file
   - Set environment variables if needed

### Environment Variables

The app uses `amplify_outputs.json` which is generated automatically. For manual deployments, ensure these are set in Amplify Console:

- `VITE_AMPLIFY_DATA_API_URL` (if using API Gateway directly)
- Other Amplify-generated variables

## Project Structure

```
├── amplify/              # Amplify Gen 2 backend resources
│   ├── backend.ts       # Backend definition
│   ├── auth/            # Authentication (Cognito)
│   ├── data/            # Data model (DynamoDB + AppSync)
│   ├── storage/         # S3 storage
│   └── functions/       # Lambda functions
├── src/
│   ├── components/      # React components
│   ├── pages/           # Page components
│   ├── lib/             # API and utilities
│   └── types/           # TypeScript types
└── dist/                # Build output
```

## Usage

### Admin Login

1. Navigate to `/login`
2. Enter admin email and password
3. Access the admin dashboard at `/admin`

### TV View for Chrome Casting

1. Click "Open TV View" button in admin header
2. A new window opens with the TV dashboard
3. Use Chrome's cast feature to cast to TV
4. Press F11 for fullscreen (optional)

### Check-In Player

1. Click "Buy-in Player" in header
2. Search for existing player or create new
3. Select door fee amount (default $20, can be customized)
4. Choose table and assignment (seat now or waitlist)
5. Complete check-in and print receipt

### Reset Day

1. Click "Reset Day" in header
2. Confirm the action
3. System will:
   - Close current ClubDay
   - Clear all tables and waitlists
   - Mark all players as left
   - Create new ClubDay
   - Auto-create default tables (14, 10, 8 for $1/$2 NL; 6 for $1/$3; 11 for $1/$2/$5)

## Default Tables

When a new ClubDay starts, these tables are automatically created:

- Table 14: $1/$2 No Limit (9 seats)
- Table 10: $1/$2 No Limit (9 seats)
- Table 8: $1/$2 No Limit (9 seats)
- Table 6: $1/$3 No Limit (9 seats)
- Table 11: $1/$2/$5 No Limit (9 seats)

## Reports

### Shift Settlement Report

- Select start and end date/time
- Shows total door fees, refunds, net total
- Optimized for 80mm receipt printer
- Print via browser print dialog

### ClubDay Report

- Based on active ClubDay
- Shows totals and optional line items
- Optimized for 80mm receipt printer

## Player State Rules

- A player can be **seated at one table** AND **waitlisted at one other table** simultaneously
- Maximum 1 seated table per player
- Maximum 1 waitlist table per player
- Seated and waitlist tables can be different

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: AWS Amplify Gen 2
- **Database**: DynamoDB
- **API**: AppSync (GraphQL)
- **Auth**: AWS Cognito
- **Realtime**: AppSync Subscriptions
- **Storage**: S3 (for audit logs/reports)

## Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Start Amplify sandbox
npx ampx sandbox
```

## Troubleshooting

### Realtime Not Connecting

- Check AWS Console for AppSync API status
- Verify IAM permissions for AppSync subscriptions
- Check browser console for connection errors
- System falls back to polling every 5 seconds if realtime fails

### Build Errors

- Ensure `amplify_outputs.json` exists (run `npx ampx sandbox` first)
- Check Node.js version (18+ required)
- Clear `node_modules` and reinstall if needed

## License

Proprietary - Final Table Poker Club
