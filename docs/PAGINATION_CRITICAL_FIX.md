# CRITICAL: Pagination Fix for Player Counting

## Issue
After 6 players were seated at a table, the count stopped updating correctly. Players could still be seated, but the displayed count was incorrect.

## Root Cause
The custom GraphQL client's `list()` function did not handle pagination. Amplify/AppSync GraphQL queries have a default limit (typically 100 items per page), and when results exceed this limit, a `nextToken` is returned to fetch the next page. Without handling pagination, only the first page of results was returned, causing inaccurate player counts.

## Solution
Implemented full pagination support in the GraphQL client and ensured all player-fetching functions use explicit high limits and handle pagination correctly.

## Critical Code Locations

### 1. GraphQL Client (`src/lib/graphql-client.ts`)
**DO NOT MODIFY** the pagination logic in `createModelHandler().list()` without understanding the full impact.

- **Default limit**: Set to 1000 to ensure we fetch all results in most cases
- **Pagination**: Recursively fetches all pages when `nextToken` is present
- **Critical**: This affects ALL list queries in the application

### 2. API Functions (`src/lib/api.ts`)
**DO NOT REMOVE** the `limit: 1000` parameter from these functions:

- `getSeatedPlayersForTable()` - Line ~708
- `getWaitlistForTable()` - Line ~1218
- `getSeatedPlayersForPlayer()` - Line ~672

These functions MUST use explicit high limits to ensure all players are fetched.

### 3. Table Counts (`src/lib/tableCounts.ts`)
The centralized counting function relies on the API functions above. If pagination breaks, counts will be inaccurate across ALL views (Admin, TV, Tablet, Public).

## Testing
To verify pagination is working:

1. Seat more than 6 players at a table
2. Verify the count updates correctly on:
   - Admin page table card
   - TV view
   - Tablet view
   - Public link
3. Check browser console for any pagination-related errors

## Why This Matters
- **Data Integrity**: Incorrect counts lead to wrong capacity checks
- **User Experience**: Players may be incorrectly told a table is full
- **Business Logic**: Table capacity enforcement relies on accurate counts
- **Multi-View Consistency**: All views must show the same count

## Breaking Changes
If pagination is removed or limits are reduced:
- Player counts will be inaccurate after ~6-100 players (depending on limit)
- Table capacity checks will fail
- Players may be incorrectly seated or rejected
- All views will show inconsistent data

## Maintenance Notes
- If Amplify changes default limits, update the default limit in `graphql-client.ts`
- If tables ever need more than 1000 seats/waitlist, increase the limit
- Monitor for pagination-related errors in production logs
