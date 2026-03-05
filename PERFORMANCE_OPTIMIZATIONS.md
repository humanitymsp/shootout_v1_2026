# Performance Optimization Recommendations

## Safe Optimizations (Low Risk, High Impact)

### 1. ✅ Reduce Polling Frequency
**Current Issue:** TableCard polls localStorage every 300ms, TVPage polls every 1-2 seconds
**Impact:** High - Reduces CPU usage and API calls significantly
**Risk:** Low - Just increases polling interval

**Changes Needed:**
- `TableCard.tsx`: Change polling from 300ms → 1000ms (line 125)
- `TVPage.tsx`: Change polling from 2000ms → 5000ms when idle (line 30)
- Add visibility-based polling (pause when tab is hidden)

### 2. ✅ Memoize TableCard Component
**Current Issue:** TableCard re-renders when parent state changes
**Impact:** Medium-High - Prevents unnecessary re-renders of all table cards
**Risk:** Low - React.memo is safe, just need to ensure props comparison works

**Changes Needed:**
- Wrap `TableCard` export with `React.memo`
- Ensure props are stable (use useCallback for handlers)

### 3. ✅ Memoize Expensive Computations
**Current Issue:** Filtering/sorting recalculates on every render
**Impact:** Medium - Reduces CPU usage during re-renders
**Risk:** Low - useMemo is safe

**Changes Needed:**
- `AdminPage.tsx`: Wrap `uniqueTables`, `activeTables`, `tablesByGameType` in `useMemo`
- Dependencies: `[tables, filterGameType, searchQuery]`

### 4. ✅ Debounce Search Inputs
**Current Issue:** Player search triggers API call on every keystroke
**Impact:** Medium - Reduces API calls significantly
**Risk:** Low - Standard pattern, just delays search slightly

**Changes Needed:**
- `CheckInModal.tsx`: Add debounce to player search (300-500ms)
- `PlayerManagementModal.tsx`: Add debounce to search input

### 5. ✅ Optimize loadPlayerAssignments
**Current Issue:** Makes individual API calls in a loop (N+1 problem)
**Impact:** High - Can reduce API calls from 20+ to 2-3 per table
**Risk:** Medium - Need to batch queries properly

**Changes Needed:**
- Batch all player ID queries into single API calls
- Use GraphQL batch queries or Promise.all with batched filters

### 6. ✅ Use useCallback for Event Handlers
**Current Issue:** Handlers recreated on every render, causing child re-renders
**Impact:** Medium - Prevents unnecessary re-renders
**Risk:** Low - Standard React optimization

**Changes Needed:**
- `AdminPage.tsx`: Wrap `handleTogglePlayerSelection`, `handleClearSelection` in useCallback
- `TableCard.tsx`: Wrap handlers in useCallback where appropriate

### 7. ✅ Add Request Deduplication
**Current Issue:** Multiple components may fetch same data simultaneously
**Impact:** Medium - Prevents duplicate API calls
**Risk:** Low - Simple caching layer

**Changes Needed:**
- Create a simple request cache/deduplication utility
- Cache recent API responses for 1-2 seconds

### 8. ✅ Lazy Load Modals
**Current Issue:** All modals loaded upfront, increasing initial bundle size
**Impact:** Medium - Faster initial page load
**Risk:** Low - React.lazy is standard

**Changes Needed:**
- Use `React.lazy()` for modals (CheckInModal, RefundModal, etc.)
- Add Suspense boundaries

## Medium Risk Optimizations

### 9. ⚠️ Optimize TV Page Data Loading
**Current Issue:** Loads all table data sequentially
**Impact:** High - Faster TV page load
**Risk:** Medium - Need to ensure all data loads correctly

**Changes Needed:**
- Batch all table data queries
- Use Promise.all for parallel loading
- Cache table data for 30 seconds

### 10. ⚠️ Virtualize Long Lists
**Current Issue:** All players/tables rendered at once
**Impact:** Medium - Better performance with 50+ items
**Risk:** Medium - Requires testing with real data

**Changes Needed:**
- Use react-window or react-virtualized for long lists
- Only render visible items

## Implementation Priority

1. **Start Here (Safest):**
   - Reduce polling frequency (#1)
   - Memoize TableCard (#2)
   - Memoize computations (#3)
   - Debounce search (#4)

2. **Next Phase:**
   - Optimize loadPlayerAssignments (#5)
   - Add useCallback (#6)
   - Request deduplication (#7)

3. **Future Enhancements:**
   - Lazy load modals (#8)
   - Optimize TV page (#9)
   - Virtualize lists (#10)

## Expected Performance Gains

- **Initial Load:** 20-30% faster (with lazy loading)
- **Runtime Performance:** 40-50% reduction in API calls
- **Re-render Performance:** 60-70% reduction in unnecessary re-renders
- **Memory Usage:** 10-15% reduction (with virtualization)

## Testing Checklist

After implementing optimizations:
- [ ] Test with multiple tables (10+)
- [ ] Test with many players (50+)
- [ ] Test real-time updates still work
- [ ] Test search functionality
- [ ] Test TV page updates
- [ ] Test on slower devices/networks
- [ ] Monitor API call frequency in Network tab
