import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { sendSMSFunction } from '../functions/sendSMS/resource';

const SMSResult = a.customType({
  success: a.boolean().required(),
  error: a.string(),
  quotaRemaining: a.integer(),
  textId: a.string(),
});

const schema = a.schema({
  Player: a
    .model({
      name: a.string().required(),
      nick: a.string().required(),
      phone: a.string(),
      email: a.string(),
      checkIns: a.hasMany('CheckIn', 'playerId'),
      receipts: a.hasMany('Receipt', 'playerId'),
      seats: a.hasMany('TableSeat', 'playerId'),
      waitlist: a.hasMany('TableWaitlist', 'playerId'),
      ledgerEntries: a.hasMany('LedgerEntry', 'playerId'),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  ClubDay: a
    .model({
      startedAt: a.datetime().required(),
      endedAt: a.datetime(),
      status: a.enum(['active', 'closed', 'archived']),
      archivedAt: a.datetime(),
      retentionExpiresAt: a.datetime(),
      tables: a.hasMany('PokerTable', 'clubDayId'),
      checkIns: a.hasMany('CheckIn', 'clubDayId'),
      receipts: a.hasMany('Receipt', 'clubDayId'),
      seats: a.hasMany('TableSeat', 'clubDayId'),
      waitlist: a.hasMany('TableWaitlist', 'clubDayId'),
      ledgerEntries: a.hasMany('LedgerEntry', 'clubDayId'),
      playerSyncs: a.hasMany('PlayerSync', 'clubDayId'),
    })
    .authorization((allow) => [
      allow.authenticated().to(['create', 'read', 'update', 'delete']),
      allow.publicApiKey().to(['read']), // For TV view - uses API key auth mode
    ]),

  PokerTable: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      tableNumber: a.integer().required(),
      gameType: a.enum(['NLH', 'BigO', 'Limit', 'PLO', 'Mixed', 'Custom']),
      stakesText: a.string().required(),
      seatsTotal: a.integer().required(),
      bombPotCount: a.integer().required(),
      lockoutCount: a.integer(),
      buyInLimits: a.string(),
      showOnTv: a.boolean(),
      status: a.enum(['OPEN', 'FULL', 'STARTING', 'CLOSED']),
      closedAt: a.datetime(),
      seats: a.hasMany('TableSeat', 'tableId'),
      waitlist: a.hasMany('TableWaitlist', 'tableId'),
    })
    .authorization((allow) => [
      allow.authenticated().to(['create', 'read', 'update', 'delete']),
      allow.publicApiKey().to(['read']), // For TV view - uses API key auth mode
    ]),

  CheckIn: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      checkinTime: a.datetime().required(),
      doorFeeAmount: a.float().required(),
      paymentMethod: a.string().required(),
      receiptId: a.id(),
      receipt: a.belongsTo('Receipt', 'receiptId'),
      refunds: a.hasMany('Refund', 'checkinId'),
      ledgerEntries: a.hasMany('LedgerEntry', 'checkinId'),
      overrideReason: a.string(),
      refundedAt: a.datetime(),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  Refund: a
    .model({
      checkinId: a.id().required(),
      checkin: a.belongsTo('CheckIn', 'checkinId'),
      refundReceiptId: a.id(),
      refundReceipt: a.belongsTo('Receipt', 'refundReceiptId'),
      refundedAt: a.datetime().required(),
      amount: a.float().required(),
      reason: a.string().required(),
      adminUser: a.string(),
      ledgerEntries: a.hasMany('LedgerEntry', 'refundId'),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  Receipt: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      receiptNumber: a.integer().required(),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      amount: a.float().required(),
      paymentMethod: a.string().required(),
      kind: a.enum(['checkin', 'refund']),
      createdBy: a.string(),
      checkIns: a.hasMany('CheckIn', 'receiptId'),
      refunds: a.hasMany('Refund', 'refundReceiptId'),
      ledgerEntries: a.hasMany('LedgerEntry', 'receiptId'),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  TableSeat: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      tableId: a.id().required(),
      table: a.belongsTo('PokerTable', 'tableId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      seatedAt: a.datetime().required(),
      leftAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['create', 'read', 'update', 'delete']),
      allow.publicApiKey().to(['read']), // For TV view - uses API key auth mode
    ]),

  TableWaitlist: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      tableId: a.id().required(),
      table: a.belongsTo('PokerTable', 'tableId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      position: a.integer().required(),
      addedAt: a.datetime().required(),
      removedAt: a.datetime(),
      calledIn: a.boolean(), // True if player was called in and hasn't paid door fee yet
    })
    .authorization((allow) => [
      allow.authenticated().to(['create', 'read', 'update', 'delete']),
      allow.publicApiKey().to(['read']), // For TV view - uses API key auth mode
    ]),

  CashCount: a
    .model({
      scope: a.enum(['clubday', 'shift']),
      clubDayId: a.id(),
      shiftStart: a.datetime(),
      shiftEnd: a.datetime(),
      countedAmount: a.float().required(),
      countedAt: a.datetime().required(),
      adminUser: a.string().required(),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  AuditLog: a
    .model({
      adminUser: a.string().required(),
      action: a.string().required(),
      entityType: a.string(),
      entityId: a.string(),
      detailsJson: a.json(),
      reason: a.string(),
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read', 'update', 'delete'])]),

  LedgerEntry: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      sequenceNumber: a.integer().required(),
      transactionType: a.enum(['checkin', 'refund']),
      amount: a.float().required(), // Positive for checkin, negative for refund
      balance: a.float().required(), // Running balance after this transaction
      checkinId: a.id(), // Reference to CheckIn if transactionType is 'checkin'
      checkin: a.belongsTo('CheckIn', 'checkinId'),
      refundId: a.id(), // Reference to Refund if transactionType is 'refund'
      refund: a.belongsTo('Refund', 'refundId'),
      receiptId: a.id(), // Reference to Receipt
      receipt: a.belongsTo('Receipt', 'receiptId'),
      playerId: a.id().required(),
      player: a.belongsTo('Player', 'playerId'),
      transactionTime: a.datetime().required(),
      adminUser: a.string(),
      notes: a.string(), // For override reasons, refund reasons, etc.
    })
    .authorization((allow) => [allow.authenticated().to(['create', 'read'])]), // Read-only after creation - no updates/deletes

  // Lightweight player sync storage for cross-device access
  // Stores players as JSON blob per club day for fast sync
  PlayerSync: a
    .model({
      clubDayId: a.id().required(),
      clubDay: a.belongsTo('ClubDay', 'clubDayId'),
      playersJson: a.json().required(), // Array of Player objects as JSON
      syncedAt: a.datetime().required(),
    })
    .authorization((allow) => [
      allow.authenticated().to(['create', 'read', 'update']),
      allow.publicApiKey().to(['read', 'create', 'update']), // TV/tablet views can read; public page writes pending signups
    ]),

  SMSResult: SMSResult,

  sendSMS: a
    .mutation()
    .arguments({
      phone: a.string().required(),
      message: a.string().required(),
      key: a.string().required(),
    })
    .returns(a.ref('SMSResult'))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()])
    .handler(a.handler.function(sendSMSFunction)),

});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

// Note: Public read access for TV view uses API key authorization mode
// The allow.guest() in the schema will use the API key mode for unauthenticated requests
