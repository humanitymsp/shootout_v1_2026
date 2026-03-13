// GraphQL client for Amplify Gen 2
// Uses generateClient from aws-amplify/api to interact with AppSync
import { generateClient as createApiClient } from 'aws-amplify/api';

// In-flight request deduplication: if the same query is already running, return its promise
const inflightRequests = new Map<string, Promise<any>>();

// Helper to convert filter objects to GraphQL filter format
function convertFilter(filter: any): any {
  if (!filter) return undefined;
  
  if (filter.and) {
    return { and: filter.and.map(convertFilter) };
  }
  if (filter.or) {
    return { or: filter.or.map(convertFilter) };
  }
  
  // Handle individual field filters
  const result: any = {};
  let inOperatorField: { key: string; values: any[] } | null = null;
  
  // First pass: process all fields except 'in' operators
  for (const [key, value] of Object.entries(filter)) {
    if (value && typeof value === 'object' && 'in' in value) {
      // Store 'in' operator for special handling
      const inArray = Array.isArray(value.in) ? value.in : [value.in];
      if (inArray.length > 0) {
        inOperatorField = { key, values: inArray };
      }
      // Skip for now, will handle below
      continue;
    }
    
    if (value && typeof value === 'object' && 'eq' in value) {
      result[key] = { eq: value.eq };
    } else if (value && typeof value === 'object' && 'contains' in value) {
      result[key] = { contains: value.contains };
    } else if (value && typeof value === 'object' && 'ge' in value) {
      result[key] = { ge: value.ge };
    } else if (value && typeof value === 'object' && 'le' in value) {
      result[key] = { le: value.le };
    } else if (value && typeof value === 'object' && 'attributeExists' in value) {
      // Handle attributeExists: false (checking for null/undefined)
      if (value.attributeExists === false) {
        result[key] = { attributeExists: false };
      }
    } else {
      result[key] = value;
    }
  }
  
  // Handle 'in' operator: convert to 'or' filter with multiple 'eq' conditions
  // AppSync/Amplify doesn't support 'in' operator in ModelIDInput, so we use 'or' instead
  if (inOperatorField) {
    const { key, values } = inOperatorField;
    if (values.length === 0) {
      // Empty array means no matches - return a filter that will never match
      return { and: [{ id: { eq: 'NEVER_MATCH_THIS_ID_' + Date.now() } }] };
    } else if (values.length === 1) {
      // Single value - just use eq
      result[key] = { eq: values[0] };
    } else if (values.length > 100) {
      // Too many values - GraphQL query might be too large
      // Return a special marker that the caller can handle
      // For now, we'll still try the 'or' approach but log a warning
      console.warn(`Large 'in' filter (${values.length} values) - consider fetching all and filtering in JavaScript`);
      const orConditions = values.map((val: any) => {
        const nestedFilter: any = { ...result }; // Include other fields
        nestedFilter[key] = { eq: val };
        return nestedFilter;
      });
      return { or: orConditions };
    } else {
      // Multiple values - create 'or' conditions
      // Each condition includes both the 'in' field match AND all other fields
      const orConditions = values.map((val: any) => {
        const nestedFilter: any = { ...result }; // Include other fields
        nestedFilter[key] = { eq: val };
        return nestedFilter;
      });
      return { or: orConditions };
    }
  }
  
  return result;
}

// Create model handler
function createModelHandler(modelName: string, apiClient: any) {
  return {
    /**
     * CRITICAL: Pagination Support
     * 
     * This function MUST handle pagination correctly to ensure accurate player counts.
     * Without pagination, only the first page of results is returned, causing:
     * - Incorrect player counts after ~6-100 players (depending on default limit)
     * - Table capacity checks to fail
     * - Inconsistent data across Admin/TV/Tablet/Public views
     * 
     * DO NOT REMOVE pagination logic or reduce the default limit without:
     * 1. Understanding the full impact on all list queries
     * 2. Testing with tables that have >6 players
     * 3. Verifying counts across all views
     * 
     * See docs/PAGINATION_CRITICAL_FIX.md for full documentation.
     */
    async list(options?: { filter?: any; limit?: number; nextToken?: string; authMode?: string }): Promise<{ data: any[] }> {
      // Request deduplication: if the same query (model+filter+authMode) is already in-flight, return its promise
      // Skip dedup for paginated requests (nextToken) since they're sequential
      if (!options?.nextToken) {
        const dedupKey = `list-${modelName}-${JSON.stringify(options?.filter || {})}-${options?.authMode || ''}`;
        const existing = inflightRequests.get(dedupKey);
        if (existing) return existing;
        
        const promise = this._listImpl(options);
        inflightRequests.set(dedupKey, promise);
        promise.finally(() => inflightRequests.delete(dedupKey));
        return promise;
      }
      return this._listImpl(options);
    },
    
    async _listImpl(options?: { filter?: any; limit?: number; nextToken?: string; authMode?: string }): Promise<{ data: any[] }> {
      // When using apiKey auth, skip relationship fields (e.g. player { ... })
      // because related models like Player may not allow publicApiKey reads,
      // which causes the entire query to fail with "Not Authorized"
      const includeRelationships = options?.authMode !== 'apiKey';
      const query = `
        query List${modelName}s($filter: Model${modelName}FilterInput, $limit: Int, $nextToken: String) {
          list${modelName}s(filter: $filter, limit: $limit, nextToken: $nextToken) {
            items {
              id
              ${getFieldsForModel(modelName, includeRelationships)}
            }
            nextToken
          }
        }
      `;
      
      const variables: any = {};
      if (options?.filter) {
        variables.filter = convertFilter(options.filter);
      }
      // Set a reasonable limit - pagination handles overflow for larger result sets
      // 200 covers typical use (tables have <20 seats, <50 waitlist entries)
      // Pagination still fetches all results if more exist
      const limit = options?.limit ?? 200;
      
      // Runtime validation: Only warn if limit wasn't explicitly set by the caller.
      // Sentinel-record lookups (SMS config, pending signups) intentionally use limit: 1.
      if (limit < 100 && options?.limit === undefined) {
        console.error(`CRITICAL: List limit (${limit}) is too low! This will break player counting. Using minimum safe limit of 100.`);
        console.error('See docs/PAGINATION_CRITICAL_FIX.md for details.');
        variables.limit = 100; // Minimum safe limit
      } else {
        variables.limit = limit;
      }
      if (options?.nextToken) {
        variables.nextToken = options.nextToken;
      }
      
      try {
        const graphqlOptions: any = { query, variables };
        if (options?.authMode) {
          graphqlOptions.authMode = options.authMode;
        }
        const result = await apiClient.graphql(graphqlOptions);
        
        // Check for GraphQL errors in response
        if ((result as any).errors && Array.isArray((result as any).errors) && (result as any).errors.length > 0) {
          const errorMessages = (result as any).errors.map((e: any) => e.message || JSON.stringify(e)).join('; ');
          
          // If it's a permission or model not found error, degrade gracefully (expected pre-auth)
          const errLower = errorMessages.toLowerCase();
          const isNonCriticalError = errLower.includes('not authorized') || 
                                     errLower.includes('not found') ||
                                     errLower.includes('does not exist') ||
                                     errLower.includes('unauthorized') ||
                                     errLower.includes('access denied') ||
                                     errLower.includes('unauth');
          
          if (isNonCriticalError) {
            console.warn(`${modelName} access denied (may be pre-auth or wrong auth mode). Continuing with empty data.`);
            return { data: [] };
          }
          
          // For unexpected errors, log as error
          console.error(`Error listing ${modelName}:`, {
            errors: (result as any).errors,
            errorMessages,
            data: (result as any).data,
            variables,
          });
          
          // Try to return partial data if available (don't throw away items because of field errors)
          const partialItems = (result as any).data?.[`list${modelName}s`]?.items;
          if (partialItems && partialItems.length > 0) {
            console.warn(`Returning ${partialItems.length} partial ${modelName} items despite errors`);
            return { data: partialItems };
          }
          return { data: [] };
        }
        
        const responseData = (result as any).data?.[`list${modelName}s`] || {};
        const items = responseData.items || [];
        const nextToken = responseData.nextToken;
        
        // CRITICAL: Handle pagination - fetch all pages recursively
        // This is essential for accurate player counts. DO NOT remove this logic.
        if (nextToken) {
          const nextPage: { data: any[] } = await this._listImpl({
            filter: options?.filter,
            limit: options?.limit ?? 200,
            nextToken,
            authMode: options?.authMode,
          });
          // Combine results from all pages
          return { data: [...items, ...(nextPage.data || [])] };
        }
        
        return { data: items };
      } catch (error: any) {
        const msg = error?.message || error?.errors?.[0]?.message || String(error);
        const isAuthError = msg.includes('Not Authorized') || msg.includes('Unauthorized') ||
                            msg.includes('401') || msg.includes('403') ||
                            error?.name === 'UnauthorizedException';
        if (isAuthError) {
          console.warn(`${modelName} list denied (auth): ${msg}`);
        } else {
          console.error(`Error listing ${modelName}:`, error);
        }
        return { data: [] };
      }
    },
    
    async get(options: { id: string }) {
      const query = `
        query Get${modelName}($id: ID!) {
          get${modelName}(id: $id) {
            id
            ${getFieldsForModel(modelName)}
          }
        }
      `;
      
      try {
        const result = await apiClient.graphql({ query, variables: { id: options.id } });
        return { data: (result as any).data?.[`get${modelName}`] };
      } catch (error) {
        console.error(`Error getting ${modelName}:`, error);
        return { data: null };
      }
    },
    
    
    async update(input: any, options?: { authMode?: string }) {
      // For update operations, only request scalar fields to avoid relationship resolution issues
      const mutation = `
        mutation Update${modelName}($input: Update${modelName}Input!) {
          update${modelName}(input: $input) {
            id
            ${getFieldsForModel(modelName, false)}
          }
        }
      `;
      
      try {
        const graphqlOptions: any = { query: mutation, variables: { input } };
        if (options?.authMode) {
          graphqlOptions.authMode = options.authMode;
        }
        const result = await apiClient.graphql(graphqlOptions);
        return { data: (result as any).data?.[`update${modelName}`] };
      } catch (error) {
        console.error(`Error updating ${modelName}:`, error);
        throw error;
      }
    },
    
    async create(input: any, options?: { authMode?: string }) {
      // For create operations, only request scalar fields to avoid relationship resolution issues
      const mutation = `
        mutation Create${modelName}($input: Create${modelName}Input!) {
          create${modelName}(input: $input) {
            id
            ${getFieldsForModel(modelName, false)}
          }
        }
      `;
      
      try {
        const graphqlOptions: any = { query: mutation, variables: { input } };
        if (options?.authMode) {
          graphqlOptions.authMode = options.authMode;
        }
        const result = await apiClient.graphql(graphqlOptions);
        return { data: (result as any).data?.[`create${modelName}`] };
      } catch (error: any) {
        console.error(`Error creating ${modelName}:`, error);
        if (error?.errors) console.error(`GraphQL errors:`, JSON.stringify(error.errors, null, 2));
        if (error?.message) console.error(`Error message:`, error.message);
        console.error(`Create input was:`, JSON.stringify(input, null, 2));
        throw error;
      }
    },
    
    async delete(options: { id: string }) {
      const mutation = `
        mutation Delete${modelName}($input: Delete${modelName}Input!) {
          delete${modelName}(input: $input) {
            id
          }
        }
      `;
      
      try {
        const result = await apiClient.graphql({ query: mutation, variables: { input: { id: options.id } } });
        return { data: (result as any).data?.[`delete${modelName}`] };
      } catch (error) {
        console.error(`Error deleting ${modelName}:`, error);
        throw error;
      }
    },
  };
}

// Get fields for each model based on the schema
// includeRelationships: if false, only return scalar fields (for mutations)
function getFieldsForModel(modelName: string, includeRelationships: boolean = true): string {
  const fieldMap: Record<string, string | ((includeRelationships: boolean) => string)> = {
    Player: `
      name
      nick
      phone
      email
      createdAt
      updatedAt
    `,
    ClubDay: `
      startedAt
      endedAt
      status
      createdAt
      updatedAt
    `,
    PokerTable: `
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
    `,
    CheckIn: `
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
    `,
    Refund: `
      checkinId
      refundReceiptId
      refundedAt
      amount
      reason
      adminUser
      createdAt
      updatedAt
    `,
    Receipt: `
      clubDayId
      receiptNumber
      playerId
      amount
      paymentMethod
      kind
      createdBy
      createdAt
      updatedAt
    `,
    TableSeat: (includeRelationships: boolean) => includeRelationships ? `
      clubDayId
      tableId
      playerId
      player {
        id
        name
        nick
        phone
        email
      }
      seatedAt
      leftAt
      createdAt
      updatedAt
    ` : `
      clubDayId
      tableId
      playerId
      seatedAt
      leftAt
      createdAt
      updatedAt
    `,
    TableWaitlist: (includeRelationships: boolean) => includeRelationships ? `
      clubDayId
      tableId
      playerId
      player {
        id
        name
        nick
        phone
        email
      }
      position
      addedAt
      removedAt
      calledIn
      createdAt
      updatedAt
    ` : `
      clubDayId
      tableId
      playerId
      position
      addedAt
      removedAt
      calledIn
      createdAt
      updatedAt
    `,
    CashCount: `
      scope
      clubDayId
      shiftStart
      shiftEnd
      countedAmount
      countedAt
      adminUser
      createdAt
      updatedAt
    `,
    AuditLog: `
      adminUser
      action
      entityType
      entityId
      detailsJson
      reason
      createdAt
      updatedAt
    `,
    LedgerEntry: `
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
    `,
    PlayerSync: `
      clubDayId
      playersJson
      syncedAt
      createdAt
      updatedAt
    `,
  };
  
  const fieldDef = fieldMap[modelName];
  if (!fieldDef) {
    return 'createdAt\nupdatedAt';
  }
  
  if (typeof fieldDef === 'function') {
    return fieldDef(includeRelationships);
  }
  
  return fieldDef;
}

// Lazy client instance - only created when needed
let cachedClient: any = null;

export function generateClient() {
  // Return cached client if it exists
  if (cachedClient) {
    return cachedClient;
  }
  
  // Create API client instance
  // This will throw if Amplify is not configured, but by importing amplify.ts
  // in main.tsx first, it should be configured by the time this is called
  const apiClient = createApiClient();
  
  cachedClient = {
    models: {
      Player: createModelHandler('Player', apiClient),
      ClubDay: createModelHandler('ClubDay', apiClient),
      PokerTable: createModelHandler('PokerTable', apiClient),
      CheckIn: createModelHandler('CheckIn', apiClient),
      Refund: createModelHandler('Refund', apiClient),
      Receipt: createModelHandler('Receipt', apiClient),
      TableSeat: createModelHandler('TableSeat', apiClient),
      TableWaitlist: createModelHandler('TableWaitlist', apiClient),
      CashCount: createModelHandler('CashCount', apiClient),
      AuditLog: createModelHandler('AuditLog', apiClient),
      LedgerEntry: createModelHandler('LedgerEntry', apiClient),
      PlayerSync: createModelHandler('PlayerSync', apiClient),
    },
    graphql: apiClient.graphql.bind(apiClient),
  };
  
  return cachedClient;
}
