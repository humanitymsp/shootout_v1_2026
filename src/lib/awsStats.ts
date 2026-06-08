import { generateClient } from './graphql-client';
import { log, logError } from './logger';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Fetch a single model count — returns count + whether there may be more (200+ means "at least") */
async function fetchModelCount(client: any, model: string): Promise<{ count: number; hasMore: boolean }> {
  try {
    // Use limit:1 just to check if records exist, avoids pulling large payloads
    const result = await withTimeout(
      (client.models as any)[model].list({ limit: 1 }),
      6000,
      { data: null }
    );
    if (!result.data) return { count: 0, hasMore: false };
    if (result.data.length === 0) return { count: 0, hasMore: false };
    
    // Records exist — fetch up to 200 (single page, no pagination triggered)
    const fullResult = await withTimeout(
      (client.models as any)[model].list({ limit: 200 }),
      8000,
      { data: [] }
    );
    const count = fullResult.data?.length || 0;
    return { count, hasMore: count >= 200 };
  } catch (error) {
    logError(`Failed to fetch ${model} count:`, error);
    return { count: 0, hasMore: false };
  }
}

export interface AWSStats {
  totalPlayers: number;
  totalClubDays: number;
  totalTables: number;
  totalCheckIns: number;
  totalRefunds: number;
  totalReceipts: number;
  totalTableSeats: number;
  totalTableWaitlists: number;
  totalLedgerEntries: number;
  totalAuditLogs: number;
  // Which counts are approximate (hit the 200 cap)
  approximateCounts: string[];
  storageSize?: string;
  estimatedMonthlyCost?: string;
  lastClubDay?: string;
}

/**
 * Fetches AWS backend statistics.
 * Queries models in small sequential batches (2 at a time) to avoid
 * overwhelming AppSync with concurrent requests.
 */
export async function getAWSStats(): Promise<AWSStats> {
  const client = generateClient();
  const stats: AWSStats = {
    totalPlayers: 0,
    totalClubDays: 0,
    totalTables: 0,
    totalCheckIns: 0,
    totalRefunds: 0,
    totalReceipts: 0,
    totalTableSeats: 0,
    totalTableWaitlists: 0,
    totalLedgerEntries: 0,
    totalAuditLogs: 0,
    approximateCounts: [],
  };

  try {
    const modelCounts: { model: string; key: keyof AWSStats }[] = [
      { model: 'Player', key: 'totalPlayers' },
      { model: 'ClubDay', key: 'totalClubDays' },
      { model: 'PokerTable', key: 'totalTables' },
      { model: 'CheckIn', key: 'totalCheckIns' },
      { model: 'Refund', key: 'totalRefunds' },
      { model: 'Receipt', key: 'totalReceipts' },
      { model: 'TableSeat', key: 'totalTableSeats' },
      { model: 'TableWaitlist', key: 'totalTableWaitlists' },
      { model: 'LedgerEntry', key: 'totalLedgerEntries' },
      { model: 'AuditLog', key: 'totalAuditLogs' },
    ];

    // Fetch in sequential batches of 2 to avoid request storms
    const batchSize = 2;
    for (let i = 0; i < modelCounts.length; i += batchSize) {
      const batch = modelCounts.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(({ model, key }) =>
          fetchModelCount(client, model).then(({ count, hasMore }) => {
            (stats as any)[key] = count;
            if (hasMore) stats.approximateCounts.push(model);
          })
        )
      );
    }

    // Get last club day for data freshness (already fetched ClubDay above)
    try {
      const clubDays = await withTimeout(
        client.models.ClubDay.list({ limit: 50 }),
        5000,
        { data: [] }
      );
      if (clubDays.data && clubDays.data.length > 0) {
        const sorted = clubDays.data
          .filter((d: any) => d.started_at)
          .sort((a: any, b: any) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        if (sorted.length > 0) {
          stats.lastClubDay = sorted[0].started_at;
        }
      }
    } catch (error) {
      logError('Failed to fetch last club day:', error);
    }

    // Estimate storage size based on average record sizes
    const avgRecordSizes: Record<string, number> = {
      Player: 500, ClubDay: 200, PokerTable: 300, CheckIn: 400,
      Refund: 300, Receipt: 300, TableSeat: 200, TableWaitlist: 200,
      LedgerEntry: 350, AuditLog: 400,
    };

    const estimatedBytes = 
      stats.totalPlayers * avgRecordSizes.Player +
      stats.totalClubDays * avgRecordSizes.ClubDay +
      stats.totalTables * avgRecordSizes.PokerTable +
      stats.totalCheckIns * avgRecordSizes.CheckIn +
      stats.totalRefunds * avgRecordSizes.Refund +
      stats.totalReceipts * avgRecordSizes.Receipt +
      stats.totalTableSeats * avgRecordSizes.TableSeat +
      stats.totalTableWaitlists * avgRecordSizes.TableWaitlist +
      stats.totalLedgerEntries * avgRecordSizes.LedgerEntry +
      stats.totalAuditLogs * avgRecordSizes.AuditLog;

    stats.storageSize = formatBytes(estimatedBytes);

    const dynamoGB = estimatedBytes / (1024 * 1024 * 1024);
    stats.estimatedMonthlyCost = `$${(dynamoGB * 0.273).toFixed(2)}`;

    log('AWS Stats fetched:', stats);
  } catch (error) {
    logError('Error fetching AWS stats:', error);
  }

  return stats;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Gets AppSync usage estimate based on today's check-in count.
 */
export async function getAppSyncStats(): Promise<{
  estimatedQueriesToday: number;
  estimatedMutationsToday: number;
  totalOperations: number;
}> {
  try {
    const client = generateClient();
    
    // Use CheckIn list (smaller, more reliable) instead of filtered LedgerEntry scan
    const checkIns = await withTimeout(
      client.models.CheckIn.list({ limit: 200 }),
      6000,
      { data: [] }
    );

    // Count today's check-ins by filtering client-side
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    
    const todayCheckIns = (checkIns.data || []).filter(
      (c: any) => c.checkin_time && c.checkin_time >= todayIso
    ).length;
    
    // Each check-in triggers ~5 queries + 2 mutations on average
    const estimatedQueries = todayCheckIns * 5;
    const estimatedMutations = todayCheckIns * 2;

    return {
      estimatedQueriesToday: estimatedQueries,
      estimatedMutationsToday: estimatedMutations,
      totalOperations: estimatedQueries + estimatedMutations,
    };
  } catch (error) {
    logError('Error fetching AppSync stats:', error);
    return {
      estimatedQueriesToday: 0,
      estimatedMutationsToday: 0,
      totalOperations: 0,
    };
  }
}
