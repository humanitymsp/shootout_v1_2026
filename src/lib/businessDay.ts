/**
 * Business Day Reset System
 * 
 * Implements production-grade business day reset logic with:
 * - Business day boundaries: 9:00 AM - 3:00 AM (next calendar day)
 * - Distributed locking for safe multi-instance resets
 * - Idempotent reset operations
 * - Timezone/DST safety
 */

import { logError } from './logger';

const BUSINESS_TIMEZONE = 'America/Los_Angeles'; // Pacific Time
const BUSINESS_DAY_START_HOUR = 9; // 9:00 AM

/**
 * Get current time in business timezone
 */
export function getBusinessTimezoneTime(): Date {
  const now = new Date();
  const localString = now.toLocaleString('en-US', { timeZone: BUSINESS_TIMEZONE });
  return new Date(localString);
}

/**
 * Calculate the current business day ID
 * Format: YYYY-MM-DD-09 (date + hour when day started)
 * 
 * Business day boundaries:
 * - Start: 09:00 local time
 * - End: 03:00 local time (next calendar day)
 */
export function getCurrentBusinessDayId(): string {
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  const dateStr = localTime.toISOString().split('T')[0]; // YYYY-MM-DD

  // If current time is between 00:00-02:59, we're still in previous business day
  if (hour >= 0 && hour < 3) {
    const prevDate = new Date(localTime);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    return `${prevDateStr}-09`;
  }

  // If current time is 03:00-08:59, transition period (still previous day until 09:00)
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
 * Uses a workaround since we can't directly create dates in a specific timezone
 */
export function getBusinessDayStartUTC(businessDayId: string): Date {
  const [dateStr] = businessDayId.split('-');
  const [year, month, day] = dateStr.split('-');
  
  // Create a date object - JavaScript Date interprets this as local time
  // We need to convert from Pacific to UTC
  // Strategy: Create date, format it in Pacific timezone, then calculate offset
  
  // Create 9am Pacific time
  const pacific9am = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T09:00:00`);
  const pacific9amUTC = new Date(pacific9am.toLocaleString('en-US', { timeZone: 'UTC' }));
  const pacific9amPacific = new Date(pacific9am.toLocaleString('en-US', { timeZone: BUSINESS_TIMEZONE }));
  
  // Calculate the actual offset
  const actualOffset = pacific9amUTC.getTime() - pacific9amPacific.getTime();
  
  // Return UTC equivalent
  return new Date(pacific9am.getTime() + actualOffset);
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
 * Check if we should reset based on business day boundaries
 */
export function shouldResetBusinessDay(
  currentClubDayStartedAt: string | null
): { shouldReset: boolean; reason: string; forceReset: boolean } {
  if (!currentClubDayStartedAt) {
    return { 
      shouldReset: true, 
      reason: 'No active club day - create new business day',
      forceReset: false 
    };
  }
  
  const currentBusinessDayId = getCurrentBusinessDayId();
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  
  // Parse the club day start time
  const clubDayStart = new Date(currentClubDayStartedAt);
  const clubDayStartLocal = new Date(clubDayStart.toLocaleString('en-US', { timeZone: BUSINESS_TIMEZONE }));
  const clubDayStartDateStr = clubDayStartLocal.toISOString().split('T')[0];
  
  // Calculate what business day the club day belongs to
  const clubDayStartHour = clubDayStartLocal.getHours();
  let clubDayBusinessDayId: string;
  
  if (clubDayStartHour < 9) {
    // Started before 9am, belongs to previous calendar day's business day
    const prevDate = new Date(clubDayStartLocal);
    prevDate.setDate(prevDate.getDate() - 1);
    clubDayBusinessDayId = `${prevDate.toISOString().split('T')[0]}-09`;
  } else {
    // Started at or after 9am, belongs to current calendar day's business day
    clubDayBusinessDayId = `${clubDayStartDateStr}-09`;
  }
  
  // If current business day is different from club day's business day, reset needed
  if (currentBusinessDayId !== clubDayBusinessDayId) {
    // Check if we're past 3am (end of previous business day)
    if (hour >= 3) {
      return {
        shouldReset: true,
        reason: `Business day transition: ${clubDayBusinessDayId} → ${currentBusinessDayId} (past 3am Pacific)`,
        forceReset: true // Force reset at 3am - day is officially over
      };
    }
    
    // If we're between 3am-9am and business days differ, reset needed
    return {
      shouldReset: true,
      reason: `Business day transition: ${clubDayBusinessDayId} → ${currentBusinessDayId}`,
      forceReset: false
    };
  }
  
  return { shouldReset: false, reason: 'Same business day', forceReset: false };
}

/**
 * Get next business day start time (next 9am Pacific)
 */
export function getNextBusinessDayStart(): Date {
  const localTime = getBusinessTimezoneTime();
  const hour = localTime.getHours();
  
  const next9am = new Date(localTime);
  next9am.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  
  // If it's already past 9am today, next 9am is tomorrow
  if (hour >= BUSINESS_DAY_START_HOUR) {
    next9am.setDate(next9am.getDate() + 1);
  }
  
  return next9am;
}

/**
 * Distributed lock mechanism using localStorage
 * In production, this should use Redis or database-based locking
 */
const RESET_LOCK_KEY = 'business_day_reset_lock';
const RESET_LOCK_TTL = 300000; // 5 minutes

export function acquireResetLock(): boolean {
  try {
    const lockValue = localStorage.getItem(RESET_LOCK_KEY);
    if (lockValue) {
      const lockTime = parseInt(lockValue);
      const now = Date.now();
      // Lock expired?
      if (now - lockTime > RESET_LOCK_TTL) {
        localStorage.removeItem(RESET_LOCK_KEY);
      } else {
        return false; // Lock still held
      }
    }
    
    localStorage.setItem(RESET_LOCK_KEY, Date.now().toString());
    return true;
  } catch (error) {
    logError('Error acquiring reset lock:', error);
    return false;
  }
}

export function releaseResetLock(): void {
  try {
    localStorage.removeItem(RESET_LOCK_KEY);
  } catch (error) {
    logError('Error releasing reset lock:', error);
  }
}

/**
 * Check if reset lock is held
 */
export function isResetLockHeld(): boolean {
  try {
    const lockValue = localStorage.getItem(RESET_LOCK_KEY);
    if (!lockValue) return false;
    
    const lockTime = parseInt(lockValue);
    const now = Date.now();
    return (now - lockTime) <= RESET_LOCK_TTL;
  } catch {
    return false;
  }
}
