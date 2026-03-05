# Tablet and Public Routes - Knowledge Base

## Overview

The application now provides **standalone URL routes** for the Tablet Management view and Public viewing page. These routes can be accessed directly via URLs, making them perfect for:
- **Tablet View**: Dedicated tablets for floor staff to manage player movements
- **Public Link**: Shareable URL for players to view table status on their mobile devices

## Routes

### `/tablet` - Tablet Management Page

**Purpose**: Full-featured tablet interface for managing player movements between tables.

**URL**: `https://yoursite.com/tablet`

**Features**:
- View all tables with seated players and waitlists
- Select players and move them between tables
- Move players to seats or waitlists
- Real-time updates via BroadcastChannel and localStorage sync
- Works with or without authentication (falls back to 'admin' user if not authenticated)
- Navigation back to admin page

**Access**:
- Click "📱 Tablet View" button in admin header (opens in new window)
- Or navigate directly to `/tablet` URL

**Use Cases**:
- Floor staff using dedicated tablets to manage player movements
- Quick access without needing to navigate through admin interface
- Multiple tablets can be used simultaneously

**Authentication**:
- Optional - works without login
- If authenticated, uses logged-in user's credentials
- If not authenticated, uses 'admin' as default user

---

### `/public` - Public Viewing Page

**Purpose**: Public-facing view of table status for players to check availability.

**URL**: `https://yoursite.com/public`

**Features**:
- View all active tables
- See seated count, open seats, and waitlist count
- Table status indicators (Open/Busy/Full)
- Buy-in limits display
- Bomb pot counts
- Real-time updates
- Mobile-optimized design
- No authentication required

**Access**:
- Click "Public Link" button in admin header (copies URL to clipboard)
- Or navigate directly to `/public` URL
- Share the URL with players via text, email, or QR code

**Use Cases**:
- Players checking table availability on their phones
- Displaying on TV screens in waiting areas
- Sharing via social media or messaging apps
- QR codes at the poker room entrance

**Authentication**:
- **No authentication required** - fully public
- Uses public API key for read-only access to table data

---

## How to Use

### Getting the Public Link

1. Log into the admin page
2. Click "Public Link" button in the header
3. The URL is automatically copied to your clipboard
4. Share the URL: `https://yoursite.com/public`

**Example**: If your site is `https://pokerclub.example.com`, the public link would be:
```
https://pokerclub.example.com/public
```

### Opening Tablet View

1. Log into the admin page
2. Click "📱 Tablet View" button in the header
3. A new window opens with the tablet interface
4. Or bookmark `/tablet` for direct access

---

## Technical Details

### Architecture Changes

**Before**:
- Tablet view was a modal component (`TabletManagementPage`) embedded in AdminPage
- Public view was a modal component (`MobileTVModal`) embedded in AdminPage
- Required admin page to be open
- Could only have one instance at a time

**After**:
- Tablet view is a standalone page (`TabletPage.tsx`) at `/tablet` route
- Public view is a standalone page (`PublicPage.tsx`) at `/public` route
- Can be opened in multiple tabs/windows simultaneously
- Independent of admin page
- Each page fetches its own data

### Data Fetching

Both pages:
- Fetch their own club day and tables data
- Use the same centralized counting functions (`getTableCounts`)
- Filter by `clubDayId` to prevent showing players from old club days
- Sync player data via `startPlayerSyncPolling`
- Listen for real-time updates via BroadcastChannel and localStorage events

### Real-Time Updates

Both pages receive real-time updates through:
1. **BroadcastChannel**: Instant updates from admin page (same browser)
2. **localStorage events**: Cross-tab updates
3. **Polling**: Periodic refresh (every 2-3 seconds) as fallback
4. **Player sync**: Polls admin device for player data updates

---

## Differences from Previous Implementation

### Tablet View

| Feature | Modal (Old) | Standalone Page (New) |
|---------|-------------|----------------------|
| Access | Via admin page button | Direct URL `/tablet` |
| Multiple instances | No | Yes |
| Independent | No (requires admin page) | Yes |
| Authentication | Required (admin page) | Optional |
| Bookmarkable | No | Yes |
| Shareable | No | Yes |

### Public View

| Feature | Modal (Old) | Standalone Page (New) |
|---------|-------------|----------------------|
| Access | Via admin page button | Direct URL `/public` |
| Shareable | No | Yes (copy/paste URL) |
| QR Code | No | Yes (can generate QR) |
| Bookmarkable | No | Yes |
| Mobile-friendly | Yes | Yes (improved) |

---

## Best Practices

### For Tablet View

1. **Bookmark the URL**: Add `/tablet` to bookmarks on dedicated tablets
2. **Full Screen**: Use browser full-screen mode (F11) for better tablet experience
3. **Multiple Tablets**: Can use multiple tablets simultaneously - each updates independently
4. **Refresh**: Use the refresh button if updates seem delayed

### For Public Link

1. **QR Code**: Generate a QR code for the `/public` URL and display at entrance
2. **Short URL**: Consider using a URL shortener for easier sharing
3. **Social Media**: Share the link on social media for players to check availability
4. **TV Display**: Can be displayed on TV screens in waiting areas
5. **Mobile First**: Optimized for mobile viewing - works great on phones

---

## Troubleshooting

### Tablet View Not Loading

- **Check internet connection**: Page needs to fetch data from backend
- **Check club day**: Ensure an active club day exists
- **Try refresh**: Click the refresh button or reload the page
- **Check console**: Open browser console for error messages

### Public View Not Showing Tables

- **Check club day**: Ensure an active club day exists
- **Check table status**: Only tables with status 'OPEN' are shown
- **Try refresh**: Reload the page
- **Check network**: Ensure backend is accessible

### Updates Not Appearing

- **Wait a few seconds**: Updates sync every 2-3 seconds
- **Check admin page**: Ensure admin page is open (for BroadcastChannel updates)
- **Refresh manually**: Use refresh button or reload page
- **Check browser console**: Look for sync errors

---

## Security Considerations

### Tablet View

- **Authentication**: Optional but recommended for audit trails
- **User tracking**: Actions are logged with user ID (or 'admin' if not authenticated)
- **Permissions**: Uses same permissions as admin page (if authenticated)

### Public View

- **Read-only**: Public view is read-only - no actions can be performed
- **No sensitive data**: Only shows table status, not player names or financial data
- **API key**: Uses public API key for read-only access
- **Rate limiting**: Consider implementing rate limiting for production use

---

## Future Enhancements

Potential improvements:
- QR code generator in admin header for public link
- Short URL service integration
- Analytics tracking for public page views
- Custom branding for public page
- Multi-language support for public page
- Push notifications for table availability changes

---

## Related Documentation

- [Pagination Critical Fix](./PAGINATION_CRITICAL_FIX.md) - Details on how player counting works
- [README.md](../README.md) - General project documentation

---

## Support

For issues or questions:
- Check browser console for errors
- Verify backend is running and accessible
- Ensure active club day exists
- Contact support: 360-721-7359
