# Business Day Reset System - Architecture Design

## Executive Summary

This document outlines a production-grade business day reset system that handles non-standard day boundaries (9:00 AM - 3:00 AM), maintains immutable ledger integrity, and provides safe, idempotent reset mechanisms.

---

## 1. Business Day Model

### Core Concept
A "business day" is an abstraction that represents a single operational period, independent of calendar dates.

### Business Day Boundaries
- **Start**: 09:00 local time
- **End**: 03:00 local time (next calendar day)
- **Duration**: 18 hours

### Business Day ID Format
```
business_day_id: YYYY-MM-DD-HH (e.g., "2026-01-27-09")
```
The ID represents the calendar date and hour when the business day started.

### Pseudocode: Current Business Day Calculation

```typescript
function getCurrentBusinessDayId(timezone: string): string {
  const now = new Date();
  const localTime = convertToTimezone(now, timezone);
  
  const hour = localTime.getHours();
  const calendarDate = localTime.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // If current time is between 00:00-02:59, we're still in previous business day
  if (hour >= 0 && hour < 3) {
    const previousDay = subtractDays(calendarDate, 1);
    return `${previousDay}-09`;
  }
  
  // If current time is 03:00-08:59, we're in transition period
  // (edge case: could be end of previous day or start of new day)
  // Default: new day starts at 09:00
  if (hour >= 3 && hour < 9) {
    // Still previous business day until 09:00
    const previousDay = subtractDays(calendarDate, 1);
    return `${previousDay}-09`;
  }
  
  // If current time is 09:00-23:59, we're in current business day
  return `${calendarDate}-09`;
}

function getBusinessDayStartTimestamp(businessDayId: string, timezone: string): Date {
  const [date, hour] = businessDayId.split('-');
  const [year, month, day] = date.split('-');
  // Parse date and set to 09:00 local time
  return createDateInTimezone(year, month, day, 9, 0, 0, timezone);
}

function getBusinessDayEndTimestamp(businessDayId: string, timezone: string): Date {
  const start = getBusinessDayStartTimestamp(businessDayId, timezone);
  // Add 18 hours to get 03:00 next day
  return addHours(start, 18);
}
```

---

## 2. Data Model Schemas

### Business Day Table
```sql
CREATE TABLE business_days (
  id VARCHAR(20) PRIMARY KEY, -- Format: "YYYY-MM-DD-09"
  start_timestamp TIMESTAMP NOT NULL, -- UTC timestamp of 09:00 start
  end_timestamp TIMESTAMP NOT NULL, -- UTC timestamp of 03:00 end
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'closed', 'archived'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  
  INDEX idx_status (status),
  INDEX idx_start_timestamp (start_timestamp)
);
```

### Players Table
```sql
CREATE TABLE players (
  id UUID PRIMARY KEY,
  nick VARCHAR(100) NOT NULL,
  name VARCHAR(200),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No business_day_id here - players persist across days
  -- Active status tracked via player_sessions
);

CREATE TABLE player_sessions (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id),
  business_day_id VARCHAR(20) NOT NULL REFERENCES business_days(id),
  check_in_time TIMESTAMP NOT NULL,
  check_out_time TIMESTAMP NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'checked_out'
  
  INDEX idx_business_day (business_day_id),
  INDEX idx_player_day (player_id, business_day_id),
  INDEX idx_status (status)
);
```

### Tables Table
```sql
CREATE TABLE tables (
  id UUID PRIMARY KEY,
  business_day_id VARCHAR(20) NOT NULL REFERENCES business_days(id),
  table_number INTEGER NOT NULL,
  game_type VARCHAR(50) NOT NULL,
  stakes_text VARCHAR(100),
  seats_total INTEGER NOT NULL DEFAULT 9,
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open', 'busy', 'full', 'closed'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_table_per_day (business_day_id, table_number),
  INDEX idx_business_day (business_day_id),
  INDEX idx_status (status)
);
```

### Ledger Table (IMMUTABLE)
```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  business_day_id VARCHAR(20) NOT NULL REFERENCES business_days(id),
  entry_type VARCHAR(50) NOT NULL, -- 'door_fee', 'buy_in', 'cash_out', 'refund', etc.
  player_id UUID REFERENCES players(id),
  table_id UUID REFERENCES tables(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  payment_method VARCHAR(50), -- 'cash', 'card', 'points', etc.
  description TEXT,
  receipt_number VARCHAR(50),
  admin_user VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- IMMUTABLE: No UPDATE or DELETE operations allowed
  -- Use application-level constraints or database triggers
  
  INDEX idx_business_day (business_day_id),
  INDEX idx_player (player_id),
  INDEX idx_table (table_id),
  INDEX idx_entry_type (entry_type),
  INDEX idx_created_at (created_at)
);

-- Prevent modifications (application-level or trigger)
CREATE TRIGGER prevent_ledger_modification
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ledger entries are immutable';
END;
```

### Table Seats & Waitlist
```sql
CREATE TABLE table_seats (
  id UUID PRIMARY KEY,
  table_id UUID NOT NULL REFERENCES tables(id),
  player_id UUID NOT NULL REFERENCES players(id),
  business_day_id VARCHAR(20) NOT NULL REFERENCES business_days(id),
  seated_at TIMESTAMP NOT NULL,
  left_at TIMESTAMP NULL,
  
  INDEX idx_table (table_id),
  INDEX idx_player (player_id),
  INDEX idx_business_day (business_day_id),
  INDEX idx_active (table_id, left_at) -- WHERE left_at IS NULL
);

CREATE TABLE table_waitlist (
  id UUID PRIMARY KEY,
  table_id UUID NOT NULL REFERENCES tables(id),
  player_id UUID NOT NULL REFERENCES players(id),
  business_day_id VARCHAR(20) NOT NULL REFERENCES business_days(id),
  added_at TIMESTAMP NOT NULL,
  removed_at TIMESTAMP NULL,
  called_in BOOLEAN DEFAULT FALSE,
  
  INDEX idx_table (table_id),
  INDEX idx_player (player_id),
  INDEX idx_business_day (business_day_id),
  INDEX idx_active (table_id, removed_at) -- WHERE removed_at IS NULL
);
```

---

## 3. Day Reset Mechanism

### Architecture: Hybrid Approach (Recommended)

**Components:**
1. **Scheduled Job**: Runs every minute, checks if reset needed
2. **Lazy Evaluation**: On first request after boundary, trigger reset
3. **Distributed Lock**: Prevents multiple nodes from resetting simultaneously

### Reset Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    RESET FLOW                               │
└─────────────────────────────────────────────────────────────┘

[Periodic Check (every minute)]
         │
         ▼
┌────────────────────┐
│ Is reset needed?   │
│ (current_time >=   │
│  03:00 AND no      │
│  active day)       │
└────────────────────┘
         │
    YES  │  NO
         │  └───► [Continue normal operation]
         ▼
┌────────────────────┐
│ Acquire Lock       │
│ (Redis/Database)   │
└────────────────────┘
         │
    LOCK │  LOCKED
    ACQ  │  └───► [Another node handling reset]
         ▼
┌────────────────────┐
│ Double-check       │
│ (idempotency)      │
│ Is reset still     │
│ needed?            │
└────────────────────┘
         │
    YES  │  NO
         │  └───► [Release lock, skip]
         ▼
┌────────────────────┐
│ Create new         │
│ business_day       │
│ record             │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Close previous     │
│ business_day       │
│ (status='closed')  │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Remove active      │
│ player sessions    │
│ (soft delete)      │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Close all tables   │
│ from previous day  │
│ (status='closed')  │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Create 3 default   │
│ tables for new day │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Release lock       │
└────────────────────┘
         │
         ▼
┌────────────────────┐
│ Broadcast event    │
│ (all clients)      │
└────────────────────┘
```

### Pseudocode: Reset Handler

```typescript
class BusinessDayResetService {
  private lockKey = 'business_day_reset_lock';
  private lockTTL = 300; // 5 minutes
  
  async checkAndResetIfNeeded(timezone: string): Promise<void> {
    const currentBusinessDayId = getCurrentBusinessDayId(timezone);
    const activeDay = await this.getActiveBusinessDay();
    
    // If current day is already active, no reset needed
    if (activeDay?.id === currentBusinessDayId) {
      return;
    }
    
    // Attempt to acquire distributed lock
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      // Another process is handling reset
      return;
    }
    
    try {
      // Double-check after acquiring lock (idempotency)
      const recheckActiveDay = await this.getActiveBusinessDay();
      if (recheckActiveDay?.id === currentBusinessDayId) {
        return; // Already reset by another process
      }
      
      await this.performReset(currentBusinessDayId, timezone);
    } finally {
      await this.releaseLock();
    }
  }
  
  private async performReset(newBusinessDayId: string, timezone: string): Promise<void> {
    // Start transaction
    await db.transaction(async (tx) => {
      // 1. Create new business day
      const newDayStart = getBusinessDayStartTimestamp(newBusinessDayId, timezone);
      const newDayEnd = getBusinessDayEndTimestamp(newBusinessDayId, timezone);
      
      await tx.insert('business_days', {
        id: newBusinessDayId,
        start_timestamp: newDayStart,
        end_timestamp: newDayEnd,
        status: 'active'
      });
      
      // 2. Close previous business day
      const previousDay = await tx.query(
        "SELECT id FROM business_days WHERE status = 'active' LIMIT 1"
      );
      
      if (previousDay.length > 0) {
        await tx.update('business_days', {
          status: 'closed',
          closed_at: new Date()
        }, { id: previousDay[0].id });
        
        const previousDayId = previousDay[0].id;
        
        // 3. Close all player sessions from previous day
        await tx.update('player_sessions', {
          status: 'checked_out',
          check_out_time: new Date()
        }, {
          business_day_id: previousDayId,
          status: 'active'
        });
        
        // 4. Close all tables from previous day
        await tx.update('tables', {
          status: 'closed'
        }, {
          business_day_id: previousDayId,
          status: ['open', 'busy', 'full']
        });
        
        // 5. Mark all seats as left
        await tx.update('table_seats', {
          left_at: new Date()
        }, {
          business_day_id: previousDayId,
          left_at: null
        });
        
        // 6. Mark all waitlist entries as removed
        await tx.update('table_waitlist', {
          removed_at: new Date()
        }, {
          business_day_id: previousDayId,
          removed_at: null
        });
      }
      
      // 7. Create 3 default tables for new day
      const defaultTables = [
        { table_number: 1, game_type: 'NLH', stakes_text: '$1/$2 No Limit' },
        { table_number: 2, game_type: 'NLH', stakes_text: '$1/$3 No Limit' },
        { table_number: 3, game_type: 'PLO5', stakes_text: '$1/$2/$5 PLO5' }
      ];
      
      for (const tableConfig of defaultTables) {
        await tx.insert('tables', {
          id: generateUUID(),
          business_day_id: newBusinessDayId,
          ...tableConfig,
          seats_total: 9,
          status: 'open'
        });
      }
    });
    
    // Broadcast reset event to all connected clients
    await this.broadcastResetEvent(newBusinessDayId);
  }
  
  private async acquireLock(): Promise<boolean> {
    // Using Redis or database-based locking
    return await redis.set(
      this.lockKey,
      processId,
      'EX', this.lockTTL,
      'NX' // Only set if not exists
    );
  }
  
  private async releaseLock(): Promise<void> {
    await redis.del(this.lockKey);
  }
}
```

---

## 4. Timezone & DST Safety

### Recommended Approach: Hybrid

**Store timestamps in UTC, business logic in local time**

```typescript
// Configuration
const BUSINESS_TIMEZONE = 'America/Los_Angeles'; // Pacific Time

// All database timestamps stored in UTC
// Business day calculations use local timezone

function convertToTimezone(utcDate: Date, timezone: string): Date {
  // Use library like date-fns-tz or moment-timezone
  return utcToZonedTime(utcDate, timezone);
}

function convertToUTC(localDate: Date, timezone: string): Date {
  return zonedTimeToUtc(localDate, timezone);
}

// Example: Get business day start in UTC
function getBusinessDayStartUTC(businessDayId: string): Date {
  const [date] = businessDayId.split('-');
  const localStart = new Date(`${date}T09:00:00`);
  return convertToUTC(localStart, BUSINESS_TIMEZONE);
}
```

### DST Handling
- Use timezone-aware libraries (date-fns-tz, moment-timezone)
- Never use fixed offsets (e.g., -0800)
- Always use IANA timezone identifiers (e.g., 'America/Los_Angeles')
- Test edge cases: Spring forward, fall back

---

## 5. Failure & Edge Cases

### Edge Case 1: App Offline During Reset
**Solution**: Lazy evaluation on next request
```typescript
async function getCurrentBusinessDay(): Promise<BusinessDay> {
  const currentDayId = getCurrentBusinessDayId(BUSINESS_TIMEZONE);
  let activeDay = await db.query("SELECT * FROM business_days WHERE id = ?", [currentDayId]);
  
  if (!activeDay) {
    // Day doesn't exist - trigger reset
    await resetService.checkAndResetIfNeeded(BUSINESS_TIMEZONE);
    activeDay = await db.query("SELECT * FROM business_days WHERE id = ?", [currentDayId]);
  }
  
  return activeDay;
}
```

### Edge Case 2: Manual Admin Reset
**Solution**: Admin override with audit trail
```sql
CREATE TABLE reset_audit_log (
  id UUID PRIMARY KEY,
  reset_type VARCHAR(50) NOT NULL, -- 'automatic', 'manual'
  previous_day_id VARCHAR(20),
  new_day_id VARCHAR(20),
  admin_user VARCHAR(100),
  reset_timestamp TIMESTAMP NOT NULL,
  notes TEXT
);
```

### Edge Case 3: Partial Reset Failure
**Solution**: Transaction rollback + retry mechanism
```typescript
async function performResetWithRetry(maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await performReset();
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        // Alert monitoring system
        await alertingService.sendCriticalAlert('Reset failed after retries', error);
        throw error;
      }
      await sleep(1000 * attempt); // Exponential backoff
    }
  }
}
```

### Idempotency Strategy
1. **Distributed Lock**: Prevents concurrent resets
2. **Double-Check Pattern**: Verify state after lock acquisition
3. **Unique Constraints**: Database prevents duplicate business days
4. **Status Checks**: Only reset if previous day is still 'active'

---

## 6. Ledger Query Patterns

### Daily Totals (Source of Truth)
```sql
-- Total door fees for a business day
SELECT 
  SUM(amount) as total_door_fees,
  COUNT(*) as transaction_count
FROM ledger_entries
WHERE business_day_id = ?
  AND entry_type = 'door_fee';

-- Player activity for a day
SELECT 
  p.nick,
  COUNT(DISTINCT le.id) as transactions,
  SUM(le.amount) as total_spent
FROM ledger_entries le
JOIN players p ON le.player_id = p.id
WHERE le.business_day_id = ?
GROUP BY p.id, p.nick;

-- Table revenue
SELECT 
  t.table_number,
  SUM(le.amount) as revenue
FROM ledger_entries le
JOIN tables t ON le.table_id = t.id
WHERE le.business_day_id = ?
GROUP BY t.id, t.table_number;
```

---

## 7. Implementation Checklist

- [ ] Create business_days table
- [ ] Implement getCurrentBusinessDayId() function
- [ ] Add business_day_id to all relevant tables
- [ ] Create distributed lock mechanism
- [ ] Implement reset service with transaction support
- [ ] Add reset audit logging
- [ ] Set up scheduled job (cron/background worker)
- [ ] Add lazy evaluation fallback
- [ ] Implement timezone conversion utilities
- [ ] Add monitoring/alerting for reset failures
- [ ] Write integration tests for edge cases
- [ ] Document manual reset procedure
- [ ] Set up backup/rollback procedures

---

## 8. Migration Strategy

### Phase 1: Add Business Day Support (Non-Breaking)
1. Create `business_days` table
2. Add `business_day_id` columns (nullable initially)
3. Backfill existing data with a "legacy" business day
4. Update application to use business_day_id

### Phase 2: Enable Reset Mechanism
1. Deploy reset service
2. Enable scheduled checks
3. Monitor first few resets closely

### Phase 3: Cleanup
1. Make `business_day_id` NOT NULL
2. Remove legacy data handling
3. Archive old business days

---

## Conclusion

This architecture provides:
- ✅ Immutable ledger (source of truth)
- ✅ Safe, idempotent resets
- ✅ Timezone/DST safety
- ✅ Production-ready error handling
- ✅ Scalable multi-node support
- ✅ Audit trail for compliance

The system treats the ledger as the single source of truth, with all daily aggregations derived from ledger queries rather than stored totals.
