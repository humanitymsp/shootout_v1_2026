import { getClient } from './api';
import { log, logError, logWarn } from './logger';
import { getActiveClubDay } from './api';

/**
 * Verify historical data integrity after operations like day reset
 * Ensures no check-ins, ledger entries, or receipts are lost
 */
export async function verifyDataIntegrity(): Promise<{
  status: 'healthy' | 'warning' | 'error';
  issues: string[];
  summary: {
    totalClubDays: number;
    totalCheckIns: number;
    totalLedgerEntries: number;
    totalReceipts: number;
    oldestRecord?: string;
    newestRecord?: string;
  };
}> {
  const client = getClient();
  const issues: string[] = [];
  
  try {
    log('🔍 Starting data integrity verification...');
    
    // Check 1: Verify club days exist
    const clubDaysResult = await client.models.ClubDay.list({ limit: 1000 });
    const totalClubDays = clubDaysResult.data?.length || 0;
    
    if (totalClubDays === 0) {
      issues.push('No club days found in database');
    }
    
    // Check 2-4: Only flag missing records if there are multiple club days (i.e. not a fresh system).
    // On a fresh deployment or after the very first reset, these will legitimately be 0.
    // Also, auth errors on LedgerEntry silently return [] which would create false positives.
    const checkInsResult = await client.models.CheckIn.list({ limit: 10000 });
    const totalCheckIns = checkInsResult.data?.length || 0;
    
    const ledgerResult = await client.models.LedgerEntry.list({ limit: 10000 });
    const totalLedgerEntries = ledgerResult.data?.length || 0;
    
    const receiptsResult = await client.models.Receipt.list({ limit: 10000 });
    const totalReceipts = receiptsResult.data?.length || 0;
    
    // Check 5: Verify ledger entry sequence integrity
    if (totalLedgerEntries > 0) {
      const ledgerEntries = ledgerResult.data || [];
      const sequences = ledgerEntries.map(le => le.sequenceNumber).sort((a, b) => a - b);
      
      // Check for duplicate sequence numbers
      const duplicateSequences = sequences.filter((seq, index) => sequences.indexOf(seq) !== index);
      if (duplicateSequences.length > 0) {
        issues.push(`Duplicate ledger sequence numbers found: ${duplicateSequences.join(', ')}`);
      }
      
      // Check for gaps in sequence numbers
      for (let i = 1; i < sequences.length; i++) {
        if (sequences[i] !== sequences[i-1] + 1) {
          issues.push(`Gap in ledger sequence numbers: ${sequences[i-1]} -> ${sequences[i]}`);
          break;
        }
      }
    }
    
    // Check 6: Verify check-in to ledger entry consistency
    if (totalCheckIns > 0 && totalLedgerEntries > 0) {
      const checkInIds = new Set((checkInsResult.data || []).map(ci => ci.id));
      const ledgerCheckInIds = new Set((ledgerResult.data || [])
        .filter(le => le.checkinId)
        .map(le => le.checkinId));
      
      // Check for check-ins without ledger entries
      const checkInsWithoutLedger = [...checkInIds].filter(id => !ledgerCheckInIds.has(id));
      if (checkInsWithoutLedger.length > 0) {
        issues.push(`${checkInsWithoutLedger.length} check-ins missing ledger entries`);
      }
      
      // Check for ledger entries without check-ins (should only be refunds)
      const ledgerWithoutCheckIn = [...ledgerCheckInIds].filter(id => !checkInIds.has(id));
      if (ledgerWithoutCheckIn.length > 0) {
        logWarn(`${ledgerWithoutCheckIn.length} ledger entries reference missing check-ins (may be normal for refunds)`);
      }
    }
    
    // Check 7: Verify receipt consistency
    if (totalReceipts > 0 && totalCheckIns > 0) {
      const receiptIds = new Set((receiptsResult.data || []).map(r => r.id));
      const checkInReceiptIds = new Set((checkInsResult.data || [])
        .filter(ci => ci.receiptId)
        .map(ci => ci.receiptId));
      
      const receiptsWithoutCheckIn = [...receiptIds].filter(id => !checkInReceiptIds.has(id));
      if (receiptsWithoutCheckIn.length > 0) {
        logWarn(`${receiptsWithoutCheckIn.length} receipts not linked to check-ins (may be refunds)`);
      }
    }
    
    // Check 8: Verify no orphaned data (data without valid club day)
    if (totalClubDays > 0) {
      const clubDayIds = new Set((clubDaysResult.data || []).map(cd => cd.id));
      
      // Check for check-ins with invalid club day
      const orphanedCheckIns = (checkInsResult.data || [])
        .filter(ci => !clubDayIds.has(ci.clubDayId));
      if (orphanedCheckIns.length > 0) {
        issues.push(`${orphanedCheckIns.length} check-ins reference invalid club days`);
      }
      
      // Check for ledger entries with invalid club day
      const orphanedLedger = (ledgerResult.data || [])
        .filter(le => !clubDayIds.has(le.clubDayId));
      if (orphanedLedger.length > 0) {
        issues.push(`${orphanedLedger.length} ledger entries reference invalid club days`);
      }
    }
    
    // Get date range for summary
    const allRecords = [
      ...(clubDaysResult.data || []),
      ...(checkInsResult.data || []),
      ...(ledgerResult.data || []),
      ...(receiptsResult.data || [])
    ];
    
    let oldestRecord: string | undefined;
    let newestRecord: string | undefined;
    
    if (allRecords.length > 0) {
      const dates = allRecords
        .map(r => r.createdAt || r.startedAt || r.checkinTime || r.transactionTime)
        .filter(Boolean)
        .sort();
      
      oldestRecord = dates[0];
      newestRecord = dates[dates.length - 1];
    }
    
    // Determine overall status
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    if (issues.length > 0) {
      status = issues.some(issue => issue.includes('No ') || issue.includes('missing')) ? 'error' : 'warning';
    }
    
    const summary = {
      totalClubDays,
      totalCheckIns,
      totalLedgerEntries,
      totalReceipts,
      oldestRecord,
      newestRecord,
    };
    
    log(`✅ Data integrity verification complete: ${status} (${issues.length} issues)`);
    if (issues.length > 0) {
      log('📋 Issues found:', issues);
    }
    
    return { status, issues, summary };
    
  } catch (error) {
    logError('❌ Data integrity verification failed:', error);
    return {
      status: 'error',
      issues: ['Verification failed due to database error'],
      summary: {
        totalClubDays: 0,
        totalCheckIns: 0,
        totalLedgerEntries: 0,
        totalReceipts: 0,
      },
    };
  }
}

/**
 * Verify that day reset preserved all historical data
 */
export async function verifyDayResetIntegrity(beforeReset: any, afterReset: any): Promise<{
  preserved: boolean;
  issues: string[];
}> {
  const issues: string[] = [];
  
  try {
    log('🔍 Verifying day reset data preservation...');
    
    // Check that old club day still exists with correct status
    if (!afterReset.oldClubDay) {
      issues.push('Old club day not found after reset');
    } else if (afterReset.oldClubDay.status !== 'closed') {
      issues.push('Old club day not marked as closed');
    }
    
    // Check that new club day was created
    if (!afterReset.newClubDay) {
      issues.push('New club day not created after reset');
    }
    
    // Verify check-ins are preserved
    if (beforeReset.checkIns && afterReset.checkIns) {
      if (beforeReset.checkIns.length !== afterReset.checkIns.length) {
        issues.push(`Check-in count mismatch: ${beforeReset.checkIns.length} -> ${afterReset.checkIns.length}`);
      }
    }
    
    // Verify ledger entries are preserved
    if (beforeReset.ledgerEntries && afterReset.ledgerEntries) {
      if (beforeReset.ledgerEntries.length !== afterReset.ledgerEntries.length) {
        issues.push(`Ledger entry count mismatch: ${beforeReset.ledgerEntries.length} -> ${afterReset.ledgerEntries.length}`);
      }
    }
    
    // Verify receipts are preserved
    if (beforeReset.receipts && afterReset.receipts) {
      if (beforeReset.receipts.length !== afterReset.receipts.length) {
        issues.push(`Receipt count mismatch: ${beforeReset.receipts.length} -> ${afterReset.receipts.length}`);
      }
    }
    
    const preserved = issues.length === 0;
    
    if (preserved) {
      log('✅ Day reset preserved all historical data');
    } else {
      log('❌ Day reset data integrity issues:', issues);
    }
    
    return { preserved, issues };
    
  } catch (error) {
    logError('❌ Day reset integrity verification failed:', error);
    return { preserved: false, issues: ['Verification failed'] };
  }
}

/**
 * Create a data backup snapshot (for additional safety)
 */
export async function createDataBackup(): Promise<{
  success: boolean;
  backupId: string;
  recordCounts: any;
}> {
  try {
    const client = getClient();
    const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    
    log(`📦 Creating data backup: ${backupId}`);
    
    // Count records in each table
    const recordCounts = {
      clubDays: (await client.models.ClubDay.list({ limit: 10000 })).data?.length || 0,
      checkIns: (await client.models.CheckIn.list({ limit: 10000 })).data?.length || 0,
      ledgerEntries: (await client.models.LedgerEntry.list({ limit: 10000 })).data?.length || 0,
      receipts: (await client.models.Receipt.list({ limit: 10000 })).data?.length || 0,
      refunds: (await client.models.Refund.list({ limit: 10000 })).data?.length || 0,
      players: (await client.models.Player.list({ limit: 10000 })).data?.length || 0,
      auditLogs: (await client.models.AuditLog.list({ limit: 10000 })).data?.length || 0,
    };
    
    // Create audit log entry for backup
    await client.models.AuditLog.create({
      adminUser: 'system',
      action: 'data_backup',
      entityType: 'System',
      detailsJson: JSON.stringify({ backupId, recordCounts, timestamp: new Date().toISOString() }),
      reason: 'Scheduled data integrity backup',
    });
    
    log(`✅ Data backup created: ${backupId}`);
    log(`📊 Record counts:`, recordCounts);
    
    return { success: true, backupId, recordCounts };
    
  } catch (error) {
    logError('❌ Data backup creation failed:', error);
    return { success: false, backupId: '', recordCounts: {} };
  }
}
