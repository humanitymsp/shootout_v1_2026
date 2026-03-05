/**
 * Business Day Reset System - Implementation Example
 * 
 * This file demonstrates how to integrate the business day reset system
 * into your existing application.
 */

import { generateClient } from './lib/graphql-client';
import { log, logError } from './lib/logger';

const BUSINESS_TIMEZONE = 'America/Los_Angeles'; // Pacific Time
const DEFAULT_TABLES = [
  { table_number: 1, game_type: 'NLH', stakes_text: '$1/$2 No Limit' },
  { table_number: 2, game_type: 'NLH', stakes_text: '$1/$3 No Limit' },
  { table_number: 3, game_type: 'PLO5', stakes_text: '$1/$2/$5 PLO5' }
];

/**
 * Get current business day ID based on local time
 */
export function getCurrentBusinessDayId(): string {
  const now = new Date();
  
  // Convert to local timezone
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: BUSINESS_TIMEZONE }));
  const hour = localTime.getHours();
  const dateStr = localTime.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // If between 00:00-02:59, still in previous business day
  if (hour >= 0 && hour < 3) {
    const prevDate = new Date(localTime);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    return `${prevDateStr}-09`;
  }
  
  // If between 03:00-08:59, transition period (still previous day until 09:00)
  if (hour >= 3 && hour < 9) {
    const prevDate = new Date(localTime);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    return `${prevDateStr}-09`;
  }
  
  // 09:00-23:59: current business day
  return `${dateStr}-09`;
}

/**
 * Get business day start timestamp (09:00 local time) in UTC
 */
export function getBusinessDayStartUTC(businessDayId: string): Date {
  const [dateStr] = businessDayId.split('-');
  const [year, month, day] = dateStr.split('-');
  
  // Create date string for 09:00 in local timezone
  const localDateStr = `${year}-${month}-${day}T09:00:00`;
  
  // Parse as if it's in the business timezone, then convert to UTC
  // Using a library like date-fns-tz would be better:
  // return zonedTimeToUtc(parseISO(localDateStr), BUSINESS_TIMEZONE);
  
  // Simple approach (for demonstration):
  const localDate = new Date(localDateStr);
  const utcOffset = getTimezoneOffset(BUSINESS_TIMEZONE, localDate);
  return new Date(localDate.getTime() - utcOffset * 60000);
}

/**
 * Get business day end timestamp (03:00 next day local time) in UTC
 */
export function getBusinessDayEndUTC(businessDayId: string): Date {
  const start = getBusinessDayStartUTC(businessDayId);
  // Add 18 hours (9 AM to 3 AM next day)
  return new Date(start.getTime() + 18 * 60 * 60 * 1000);
}

/**
 * Get timezone offset in minutes (simplified - use proper library in production)
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  // This is simplified - use date-fns-tz or similar in production
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (tzDate.getTime() - utcDate.getTime()) / 60000;
}

/**
 * Business Day Reset Service
 */
export class BusinessDayResetService {
  private client = generateClient();
  private lockKey = 'business_day_reset_lock';
  private lockTTL = 300; // 5 minutes
  
  /**
   * Check if reset is needed and perform it if necessary
   * This should be called periodically (every minute) and on app startup
   */
  async checkAndResetIfNeeded(): Promise<void> {
    try {
      const currentBusinessDayId = getCurrentBusinessDayId();
      const activeDay = await this.getActiveBusinessDay();
      
      // If current day is already active, no reset needed
      if (activeDay?.id === currentBusinessDayId) {
        log('Business day check: Current day is active', { currentBusinessDayId });
        return;
      }
      
      log('Business day reset needed', { 
        currentDayId: currentBusinessDayId,
        activeDayId: activeDay?.id 
      });
      
      // Attempt to acquire distributed lock
      const lockAcquired = await this.acquireLock();
      if (!lockAcquired) {
        log('Reset lock already held by another process');
        return;
      }
      
      try {
        // Double-check after acquiring lock (idempotency)
        const recheckActiveDay = await this.getActiveBusinessDay();
        if (recheckActiveDay?.id === currentBusinessDayId) {
          log('Reset already completed by another process');
          return;
        }
        
        await this.performReset(currentBusinessDayId);
      } finally {
        await this.releaseLock();
      }
    } catch (error) {
      logError('Error in business day reset check:', error);
      throw error;
    }
  }
  
  /**
   * Get the currently active business day
   */
  private async getActiveBusinessDay(): Promise<{ id: string } | null> {
    try {
      const { data } = await this.client.models.BusinessDay.list({
        filter: { status: { eq: 'active' } },
        limit: 1
      });
      
      return data && data.length > 0 ? { id: data[0].id } : null;
    } catch (error) {
      logError('Error fetching active business day:', error);
      return null;
    }
  }
  
  /**
   * Perform the actual reset operation
   */
  private async performReset(newBusinessDayId: string): Promise<void> {
    log('Starting business day reset', { newBusinessDayId });
    
    const startTime = Date.now();
    
    try {
      // 1. Create new business day record
      const dayStart = getBusinessDayStartUTC(newBusinessDayId);
      const dayEnd = getBusinessDayEndUTC(newBusinessDayId);
      
      await this.client.models.BusinessDay.create({
        id: newBusinessDayId,
        start_timestamp: dayStart.toISOString(),
        end_timestamp: dayEnd.toISOString(),
        status: 'active'
      });
      
      log('Created new business day', { newBusinessDayId });
      
      // 2. Close previous business day
      const previousDay = await this.getActiveBusinessDay();
      
      if (previousDay && previousDay.id !== newBusinessDayId) {
        await this.client.models.BusinessDay.update({
          id: previousDay.id,
          status: 'closed',
          closed_at: new Date().toISOString()
        });
        
        log('Closed previous business day', { previousDayId: previousDay.id });
        
        // 3. Close all player sessions from previous day
        await this.closePlayerSessions(previousDay.id);
        
        // 4. Close all tables from previous day
        await this.closeTables(previousDay.id);
        
        // 5. Mark all seats as left
        await this.closeSeats(previousDay.id);
        
        // 6. Mark all waitlist entries as removed
        await this.closeWaitlist(previousDay.id);
      }
      
      // 7. Create default tables for new day
      await this.createDefaultTables(newBusinessDayId);
      
      const duration = Date.now() - startTime;
      log('Business day reset completed successfully', { 
        newBusinessDayId,
        duration: `${duration}ms`
      });
      
      // 8. Broadcast reset event to all clients
      await this.broadcastResetEvent(newBusinessDayId);
      
    } catch (error) {
      logError('Error during business day reset:', error);
      throw error;
    }
  }
  
  /**
   * Close all active player sessions for a business day
   */
  private async closePlayerSessions(businessDayId: string): Promise<void> {
    try {
      const { data: sessions } = await this.client.models.PlayerSession.list({
        filter: {
          and: [
            { businessDayId: { eq: businessDayId } },
            { status: { eq: 'active' } }
          ]
        }
      });
      
      for (const session of data || []) {
        await this.client.models.PlayerSession.update({
          id: session.id,
          status: 'checked_out',
          check_out_time: new Date().toISOString()
        });
      }
      
      log(`Closed ${data?.length || 0} player sessions`);
    } catch (error) {
      logError('Error closing player sessions:', error);
      throw error;
    }
  }
  
  /**
   * Close all tables for a business day
   */
  private async closeTables(businessDayId: string): Promise<void> {
    try {
      const { data: tables } = await this.client.models.Table.list({
        filter: {
          and: [
            { businessDayId: { eq: businessDayId } },
            { status: { ne: 'closed' } }
          ]
        }
      });
      
      for (const table of data || []) {
        await this.client.models.Table.update({
          id: table.id,
          status: 'closed'
        });
      }
      
      log(`Closed ${data?.length || 0} tables`);
    } catch (error) {
      logError('Error closing tables:', error);
      throw error;
    }
  }
  
  /**
   * Mark all seats as left for a business day
   */
  private async closeSeats(businessDayId: string): Promise<void> {
    try {
      const { data: seats } = await this.client.models.TableSeat.list({
        filter: {
          and: [
            { businessDayId: { eq: businessDayId } },
            { leftAt: { attributeExists: false } }
          ]
        }
      });
      
      for (const seat of data || []) {
        await this.client.models.TableSeat.update({
          id: seat.id,
          left_at: new Date().toISOString()
        });
      }
      
      log(`Closed ${data?.length || 0} seats`);
    } catch (error) {
      logError('Error closing seats:', error);
      throw error;
    }
  }
  
  /**
   * Mark all waitlist entries as removed for a business day
   */
  private async closeWaitlist(businessDayId: string): Promise<void> {
    try {
      const { data: waitlist } = await this.client.models.TableWaitlist.list({
        filter: {
          and: [
            { businessDayId: { eq: businessDayId } },
            { removedAt: { attributeExists: false } }
          ]
        }
      });
      
      for (const entry of data || []) {
        await this.client.models.TableWaitlist.update({
          id: entry.id,
          removed_at: new Date().toISOString()
        });
      }
      
      log(`Closed ${data?.length || 0} waitlist entries`);
    } catch (error) {
      logError('Error closing waitlist:', error);
      throw error;
    }
  }
  
  /**
   * Create default tables for a new business day
   */
  private async createDefaultTables(businessDayId: string): Promise<void> {
    try {
      for (const tableConfig of DEFAULT_TABLES) {
        await this.client.models.Table.create({
          business_day_id: businessDayId,
          table_number: tableConfig.table_number,
          game_type: tableConfig.game_type,
          stakes_text: tableConfig.stakes_text,
          seats_total: 9,
          status: 'open'
        });
      }
      
      log(`Created ${DEFAULT_TABLES.length} default tables`);
    } catch (error) {
      logError('Error creating default tables:', error);
      throw error;
    }
  }
  
  /**
   * Acquire distributed lock (using Redis or database)
   */
  private async acquireLock(): Promise<boolean> {
    try {
      // Using localStorage as a simple lock mechanism (for single-instance)
      // In production, use Redis or database-based locking
      const lockValue = localStorage.getItem(this.lockKey);
      if (lockValue) {
        const lockTime = parseInt(lockValue);
        const now = Date.now();
        // Lock expired?
        if (now - lockTime > this.lockTTL * 1000) {
          localStorage.removeItem(this.lockKey);
        } else {
          return false; // Lock still held
        }
      }
      
      localStorage.setItem(this.lockKey, Date.now().toString());
      return true;
    } catch (error) {
      logError('Error acquiring lock:', error);
      return false;
    }
  }
  
  /**
   * Release distributed lock
   */
  private async releaseLock(): Promise<void> {
    try {
      localStorage.removeItem(this.lockKey);
    } catch (error) {
      logError('Error releasing lock:', error);
    }
  }
  
  /**
   * Broadcast reset event to all connected clients
   */
  private async broadcastResetEvent(businessDayId: string): Promise<void> {
    try {
      // Use BroadcastChannel for same-origin tabs
      const channel = new BroadcastChannel('business-day-reset');
      channel.postMessage({
        type: 'business-day-reset',
        businessDayId,
        timestamp: new Date().toISOString()
      });
      channel.close();
      
      // Also set localStorage flag for cross-tab communication
      localStorage.setItem('business-day-reset', JSON.stringify({
        businessDayId,
        timestamp: Date.now()
      }));
      
      log('Broadcasted reset event');
    } catch (error) {
      logError('Error broadcasting reset event:', error);
      // Don't throw - this is not critical
    }
  }
}

/**
 * Initialize periodic reset checks
 * Call this on app startup
 */
export function initializeBusinessDayReset(): void {
  const resetService = new BusinessDayResetService();
  
  // Check immediately on startup
  resetService.checkAndResetIfNeeded().catch(error => {
    logError('Startup reset check failed:', error);
  });
  
  // Check every minute
  setInterval(() => {
    resetService.checkAndResetIfNeeded().catch(error => {
      logError('Periodic reset check failed:', error);
    });
  }, 60000); // 60 seconds
  
  log('Business day reset service initialized');
}

/**
 * Get current business day (with lazy reset if needed)
 * Use this function whenever you need to get the current business day
 */
export async function getCurrentBusinessDay(): Promise<{ id: string }> {
  const resetService = new BusinessDayResetService();
  const currentDayId = getCurrentBusinessDayId();
  
  // Ensure current day exists (lazy reset)
  await resetService.checkAndResetIfNeeded();
  
  return { id: currentDayId };
}
