/**
 * GSI-based Query Helpers
 * 
 * Amplify Gen 2 auto-creates Global Secondary Indexes (GSIs) for every belongsTo
 * relationship. The default .list({ filter: { clubDayId: { eq: ... } } }) does a
 * full DynamoDB TABLE SCAN (reads every item), which is extremely expensive when
 * tables accumulate historical data.
 * 
 * These helpers use raw GraphQL queries that hit the ClubDay relationship resolvers,
 * which AppSync routes through the GSI (DynamoDB Query, not Scan). This reads ONLY
 * matching items — typically 98%+ cheaper.
 * 
 * GSI mappings (auto-created by Amplify from belongsTo relationships):
 *   TableSeat     → gsi-ClubDay.seats      (clubDayId)
 *   TableWaitlist → gsi-ClubDay.waitlist    (clubDayId)
 *   PokerTable    → gsi-ClubDay.tables      (clubDayId)
 *   CheckIn       → gsi-ClubDay.checkIns    (clubDayId)
 *   PlayerSync    → gsi-ClubDay.playerSyncs (clubDayId)  [already converted]
 * 
 * ROLLBACK: If any GSI query fails, the caller falls back to the original Scan.
 */

import { getClient } from './api';

/**
 * COMPOUND QUERY: Fetch tables + seats + waitlist in a SINGLE GraphQL request.
 * 
 * This replaces 3 separate GSI queries (queryTablesByClubDay + querySeatsByClubDay +
 * queryWaitlistByClubDay) with one call. AppSync bills per resolver invocation, so:
 *   Before: 3 calls × 2 ops each (getClubDay + nested) = 6 operations
 *   After:  1 call × 4 ops (getClubDay + 3 nested) = 4 operations  (~33% savings)
 * 
 * Returns { tables, seats, waitlist } arrays of raw Amplify-shaped records.
 * Returns empty arrays on failure — callers should fall back to individual queries or Scan.
 */
export async function queryClubDayCompound(
  clubDayId: string,
  authMode?: string
): Promise<{ tables: any[]; seats: any[]; waitlist: any[] }> {
  const empty = { tables: [], seats: [], waitlist: [] };
  try {
    const client = getClient();
    if (!client?.graphql) return empty;

    const query = `
      query GetClubDayCompound($id: ID!, $limit: Int) {
        getClubDay(id: $id) {
          tables(limit: $limit) {
            items {
              id
              clubDayId
              tableNumber
              gameType
              stakesText
              seatsTotal
              bombPotCount
              lockoutCount
              buyInLimits
              showOnTv
              status
              closedAt
              createdAt
              updatedAt
            }
            nextToken
          }
          seats(limit: $limit) {
            items {
              id
              clubDayId
              tableId
              playerId
              seatedAt
              leftAt
              createdAt
              updatedAt
            }
            nextToken
          }
          waitlist(limit: $limit) {
            items {
              id
              clubDayId
              tableId
              playerId
              position
              addedAt
              removedAt
              calledIn
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    const options: any = {
      query,
      variables: { id: clubDayId, limit: 1000 },
    };
    if (authMode) options.authMode = authMode;
    const result: any = await client.graphql(options);
    const clubDay = result?.data?.getClubDay;
    if (!clubDay) return empty;

    let tables = clubDay.tables?.items || [];
    let seats = clubDay.seats?.items || [];
    let waitlist = clubDay.waitlist?.items || [];

    // Handle pagination — if any collection has a nextToken, fetch remaining pages
    // individually (rare: only if >1000 items in a single collection)
    if (clubDay.tables?.nextToken) {
      const extra = await queryTablesByClubDay(clubDayId, authMode);
      if (extra.length > tables.length) tables = extra;
    }
    if (clubDay.seats?.nextToken) {
      const extra = await querySeatsByClubDay(clubDayId, authMode);
      if (extra.length > seats.length) seats = extra;
    }
    if (clubDay.waitlist?.nextToken) {
      const extra = await queryWaitlistByClubDay(clubDayId, authMode);
      if (extra.length > waitlist.length) waitlist = extra;
    }

    return { tables, seats, waitlist };
  } catch (error) {
    console.warn('queryClubDayCompound failed, caller should fall back:', error);
    return empty;
  }
}

/**
 * Query PokerTables for a club day via GSI (gsi-ClubDay.tables).
 * Returns raw Amplify-shaped records. Caller converts with toPokerTable().
 */
export async function queryTablesByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayTables($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          tables(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              tableNumber
              gameType
              stakesText
              seatsTotal
              bombPotCount
              lockoutCount
              buyInLimits
              showOnTv
              status
              closedAt
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.tables;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('queryTablesByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}

/**
 * Query TableSeats for a club day via GSI (gsi-ClubDay.seats).
 * Returns raw Amplify-shaped records.
 */
export async function querySeatsByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDaySeats($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          seats(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              tableId
              playerId
              seatedAt
              leftAt
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.seats;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('querySeatsByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}

/**
 * Query TableWaitlist for a club day via GSI (gsi-ClubDay.waitlist).
 * Returns raw Amplify-shaped records.
 */
export async function queryWaitlistByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayWaitlist($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          waitlist(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              tableId
              playerId
              position
              addedAt
              removedAt
              calledIn
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.waitlist;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('queryWaitlistByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}

/**
 * Query CheckIns for a club day via GSI (gsi-ClubDay.checkIns).
 * Returns raw Amplify-shaped records.
 */
export async function queryCheckInsByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayCheckIns($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          checkIns(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              playerId
              checkinTime
              doorFeeAmount
              paymentMethod
              receiptId
              overrideReason
              refundedAt
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.checkIns;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('queryCheckInsByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}

/**
 * Query Receipts for a club day via GSI (gsi-ClubDay.receipts).
 * Returns raw Amplify-shaped records.
 */
export async function queryReceiptsByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayReceipts($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          receipts(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              receiptNumber
              playerId
              amount
              paymentMethod
              kind
              createdBy
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.receipts;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('queryReceiptsByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}

/**
 * Query LedgerEntries for a club day via GSI (gsi-ClubDay.ledgerEntries).
 * Returns raw Amplify-shaped records.
 */
export async function queryLedgerEntriesByClubDay(clubDayId: string, authMode?: string): Promise<any[]> {
  try {
    const client = getClient();
    if (!client?.graphql) return [];

    const query = `
      query GetClubDayLedgerEntries($id: ID!, $limit: Int, $nextToken: String) {
        getClubDay(id: $id) {
          ledgerEntries(limit: $limit, nextToken: $nextToken) {
            items {
              id
              clubDayId
              sequenceNumber
              transactionType
              amount
              balance
              checkinId
              refundId
              receiptId
              playerId
              transactionTime
              adminUser
              notes
              createdAt
              updatedAt
            }
            nextToken
          }
        }
      }
    `;

    let allItems: any[] = [];
    let nextToken: string | null = null;

    do {
      const options: any = {
        query,
        variables: { id: clubDayId, limit: 1000, nextToken },
      };
      if (authMode) options.authMode = authMode;
      const result: any = await client.graphql(options);
      const page = result?.data?.getClubDay?.ledgerEntries;
      if (page?.items) allItems = allItems.concat(page.items);
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return allItems;
  } catch (error) {
    console.warn('queryLedgerEntriesByClubDay GSI query failed, caller should fall back to Scan:', error);
    return [];
  }
}
