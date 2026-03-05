export interface Player {
  id: string;
  name: string;
  nick: string;
  phone?: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface ClubDay {
  id: string;
  started_at: string;
  ended_at?: string;
  status: 'active' | 'closed';
  created_at: string;
}

export interface PokerTable {
  id: string;
  club_day_id: string;
  table_number: number;
  game_type: 'NLH' | 'BigO' | 'Limit' | 'PLO' | 'Mixed' | 'Custom';
  stakes_text: string;
  seats_total: number;
  bomb_pot_count: number;
  lockout_count?: number;
  buy_in_limits?: string;
  show_on_tv?: boolean;
  status: 'OPEN' | 'FULL' | 'STARTING' | 'CLOSED';
  created_at: string;
  closed_at?: string;
  seats_filled?: number;
  waitlist_count?: number;
  // Persistent table features
  is_persistent?: boolean;
  public_signups?: boolean;
  persistent_table_id?: string; // Unique ID for persistent tables
}

export interface PersistentTable {
  id: string;
  api_table_id?: string; // Links to the real PokerTable record in DynamoDB
  table_number: number;
  game_type: 'NLH' | 'BigO' | 'Limit' | 'PLO' | 'Mixed' | 'Custom';
  stakes_text: string;
  seats_total: number;
  bomb_pot_count: number;
  lockout_count?: number;
  buy_in_limits?: string;
  show_on_tv?: boolean;
  public_signups: boolean;
  status: 'OPEN' | 'FULL' | 'STARTING' | 'CLOSED';
  created_at: string;
  updated_at: string;
  seats_filled?: number;
  waitlist_count?: number;
  // Public signup waitlist
  public_waitlist: PersistentTableWaitlist[];
}

export interface PersistentTableWaitlist {
  id: string;
  persistent_table_id: string;
  player_name: string;
  player_phone: string;
  position: number;
  added_at: string;
  removed_at?: string;
  created_at: string;
}

export interface CheckIn {
  id: string;
  club_day_id: string;
  player_id: string;
  checkin_time: string;
  door_fee_amount: number;
  payment_method: 'cash';
  receipt_id?: string;
  override_reason?: string;
  refunded_at?: string;
  created_at: string;
  player?: Player;
  receipt?: Receipt;
}

export interface Refund {
  id: string;
  checkin_id: string;
  refunded_at: string;
  amount: number;
  reason: string;
  refund_receipt_id?: string;
  admin_user?: string;
  created_at: string;
  checkin?: CheckIn;
}

export interface Receipt {
  id: string;
  club_day_id: string;
  receipt_number: number;
  created_at: string;
  player_id: string;
  amount: number;
  payment_method: string;
  kind: 'checkin' | 'refund';
  created_by?: string;
  player?: Player;
}

export interface TableSeat {
  id: string;
  club_day_id: string;
  table_id: string;
  player_id: string;
  seated_at: string;
  left_at?: string;
  created_at: string;
  player?: Player;
  table?: PokerTable;
}

export interface TableWaitlist {
  id: string;
  club_day_id: string;
  table_id: string;
  player_id: string;
  position: number;
  added_at: string;
  removed_at?: string;
  created_at: string;
  called_in?: boolean; // True if player was called in and hasn't paid door fee yet
  player?: Player;
  table?: PokerTable;
}

export interface CashCount {
  id: string;
  scope: 'clubday' | 'shift';
  club_day_id?: string;
  shift_start?: string;
  shift_end?: string;
  counted_amount: number;
  counted_at: string;
  admin_user: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  created_at: string;
  admin_user: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  details_json?: any;
  reason?: string;
}

export interface LedgerEntry {
  id: string;
  club_day_id: string;
  sequence_number: number;
  transaction_type: 'checkin' | 'refund';
  amount: number; // Positive for checkin, negative for refund
  balance: number; // Running balance after this transaction
  checkin_id?: string;
  refund_id?: string;
  receipt_id: string;
  player_id: string;
  transaction_time: string;
  admin_user?: string;
  notes?: string;
  created_at: string;
}

export interface PlayerTableAssignment {
  player_id: string;
  name: string;
  nick: string;
  club_day_id: string;
  seated_table_id?: string;
  seated_table_number?: number;
  waitlist_table_id?: string;
  waitlist_table_number?: number;
}
