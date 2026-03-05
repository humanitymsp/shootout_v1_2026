import { log, logError } from './logger';

export interface SMSMessage {
  to: string;
  message: string;
  from?: string;
}

export interface SMSResult {
  success: boolean;
  error?: string;
  quotaRemaining?: number;
  messageId?: string;
}

export interface SMSSettings {
  enabled: boolean;
  apiKey: string;
  checkInNotifications: boolean;
  marketingMessages: boolean;
  marketingMessage?: string;
  lastMarketingSent?: string;
  scheduledCampaigns?: ScheduledCampaign[];
}

export interface ScheduledCampaign {
  id: string;
  name: string;
  message: string;
  scheduledDate: string;
  scheduledTime: string;
  isActive: boolean;
  sentAt?: string;
  createdAt: string;
  targetCount?: number;
  sentCount?: number;
  failedCount?: number;
  errors?: string[];
  isTemplate?: boolean; // New field for saved templates
  lastUsed?: string; // New field for tracking when template was last used
}

export interface SMSQueue {
  id: string;
  type: 'marketing' | 'checkin' | 'campaign';
  recipient: { name: string; phone: string };
  message: string;
  campaignId?: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextRetry?: string;
  createdAt: string;
  sentAt?: string;
  error?: string;
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string {
  if (!phone || phone.trim() === '') {
    return '';
  }
  
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) {
    return '';
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

// Sentinel ID for storing SMS config in DynamoDB PlayerSync table
const SMS_CONFIG_SENTINEL_CLUB_DAY_ID = 'sms-config-sentinel';

/**
 * Save SMS API key to DynamoDB so public-facing pages on other devices can send SMS.
 * Called from admin when SMS settings are saved.
 */
export async function syncSMSKeyToDB(): Promise<void> {
  const settings = getSMSSettings();
  if (!settings.enabled || !settings.apiKey) return;
  try {
    const { generateClient } = await import('./graphql-client');
    const client = generateClient();
    // Check if config record already exists
    const { data: existing } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: SMS_CONFIG_SENTINEL_CLUB_DAY_ID } },
      limit: 1,
      authMode: 'apiKey',
    });
    const payload = JSON.stringify({ apiKey: settings.apiKey, enabled: settings.enabled });
    if (existing && existing.length > 0) {
      await client.models.PlayerSync.update({
        id: existing[0].id,
        playersJson: payload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    } else {
      await client.models.PlayerSync.create({
        clubDayId: SMS_CONFIG_SENTINEL_CLUB_DAY_ID,
        playersJson: payload,
        syncedAt: new Date().toISOString(),
      }, { authMode: 'apiKey' });
    }
    log('[SMS] API key synced to DynamoDB');
  } catch (error) {
    logError('[SMS] Failed to sync API key to DynamoDB:', error);
  }
}

/**
 * Read SMS API key from DynamoDB. Used by public page on other devices.
 */
export async function getSMSKeyFromDB(): Promise<string | null> {
  try {
    const { generateClient } = await import('./graphql-client');
    const client = generateClient();
    const { data } = await client.models.PlayerSync.list({
      filter: { clubDayId: { eq: SMS_CONFIG_SENTINEL_CLUB_DAY_ID } },
      limit: 1,
      authMode: 'apiKey',
    });
    if (data && data.length > 0) {
      const config = typeof data[0].playersJson === 'string'
        ? JSON.parse(data[0].playersJson)
        : data[0].playersJson;
      if (config?.enabled && config?.apiKey) return config.apiKey;
    }
  } catch (error) {
    logError('[SMS] Failed to read API key from DynamoDB:', error);
  }
  return null;
}

/**
 * Send SMS via AppSync sendSMS mutation → Lambda → TextBelt.
 *
 * The Lambda handler uses URLSearchParams with Content-Type:
 * application/x-www-form-urlencoded, which is REQUIRED for TextBelt
 * to actually deliver SMS. (JSON requests get success:true from TextBelt
 * but carriers mark them FAILED and the message never arrives.)
 *
 * Uses apiKey authMode so the unauthenticated public page can call it.
 */
export async function sendSMS(message: SMSMessage, apiKey: string): Promise<SMSResult> {
  const phone = normalizePhone(message.to);
  const normalizedApiKey = (apiKey || '').trim();

  log('[SMS] Starting send to:', phone);
  log('[SMS] Message length:', message.message.length);
  log('[SMS] API key length:', normalizedApiKey?.length);

  if (!phone || phone.trim() === '') {
    log('[SMS] ERROR: Phone number is empty or invalid');
    return { success: false, error: 'Phone number is required' };
  }

  if (!message.message || message.message.trim() === '') {
    log('[SMS] ERROR: Message is empty');
    return { success: false, error: 'Message is required' };
  }

  if (!normalizedApiKey) {
    log('[SMS] ERROR: API key is empty');
    return { success: false, error: 'API key is required' };
  }

  // Use AppSync sendSMS mutation (deployed Amplify backend → Lambda → TextBelt)
  // Try userPool auth first (admin), fall back to apiKey (public page)
  const mutation = `
    mutation SendSMS($phone: String!, $message: String!, $key: String!) {
      sendSMS(phone: $phone, message: $message, key: $key) {
        success
        error
        quotaRemaining
        textId
      }
    }
  `;

  const authModes: Array<'userPool' | 'apiKey'> = ['userPool', 'apiKey'];
  let lastError = 'SMS send failed';

  try {
    const { generateClient } = await import('./graphql-client');
    const client = generateClient();

    for (const authMode of authModes) {
      try {
        log(`[SMS] Calling sendSMS mutation (authMode: ${authMode})...`);
        const result = await client.graphql({
          query: mutation,
          variables: { phone, message: message.message, key: normalizedApiKey },
          authMode,
        });

        const data = (result as any).data?.sendSMS;
        log('[SMS] Result:', JSON.stringify(data));

        if (data && typeof data.success === 'boolean') {
          if (data.success) {
            return {
              success: true,
              error: data.error,
              quotaRemaining: data.quotaRemaining,
              messageId: data.textId,
            };
          }
          lastError = data.error || `sendSMS returned unsuccessful (${authMode})`;
          logError('[SMS] TextBelt rejected message:', lastError);
          return { success: false, error: lastError };
        }

        lastError = `No response from sendSMS mutation (${authMode})`;
        logError('[SMS]', lastError);
      } catch (error: any) {
        const errMsg = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
        logError(`[SMS] Mutation failed (${authMode}):`, errMsg);
        lastError = errMsg;
        // Continue to next auth mode
      }
    }
  } catch (error: any) {
    const errMsg = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
    logError('[SMS] Client init failed:', errMsg);
    lastError = errMsg;
  }

  logError('[SMS] All auth modes failed. Last error:', lastError);
  return { success: false, error: lastError };
}

/**
 * Get SMS settings from localStorage
 */
export function getSMSSettings(): SMSSettings {
  try {
    const stored = localStorage.getItem('sms-settings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    logError('Error loading SMS settings:', error);
  }
  
  // Default settings
  return {
    enabled: false,
    apiKey: '',
    checkInNotifications: false,
    marketingMessages: false,
  };
}

/**
 * Save SMS settings to localStorage
 */
export function saveSMSSettings(settings: SMSSettings): void {
  try {
    localStorage.setItem('sms-settings', JSON.stringify(settings));
    log('💾 SMS settings saved');
  } catch (error) {
    logError('Error saving SMS settings:', error);
  }
}

/**
 * Send check-in notification SMS
 */
export async function sendCheckInNotification(
  playerName: string,
  phoneNumber: string,
  tableNumber?: number,
  stakes?: string,
  position?: number
): Promise<{ sent: boolean; error?: string }> {
  const settings = getSMSSettings();
  
  if (!settings.enabled) {
    logError('[SMS] Check-in notification skipped: SMS is disabled in settings');
    return { sent: false };
  }
  if (!settings.checkInNotifications) {
    logError('[SMS] Check-in notification skipped: Check-in Notifications toggle is OFF in SMS settings');
    return { sent: false };
  }
  if (!settings.apiKey) {
    logError('[SMS] Cannot send check-in notification: API key is missing in SMS settings');
    return { sent: false, error: 'SMS API key not configured' };
  }

  let message = `Hi ${playerName}! You're checked in`;
  
  if (tableNumber && stakes) {
    message += ` at Table ${tableNumber} (${stakes})`;
  } else if (position) {
    message += ` and are #${position} on the waitlist`;
  }
  
  message += `. Good luck! - Final Table Poker Club`;

  const result = await sendSMS(
    { to: phoneNumber, message },
    settings.apiKey
  );

  if (!result.success) {
    logError('[SMS] Check-in notification failed:', result.error);
  }

  return { sent: result.success, error: result.error };
}

/**
 * Get all players with phone numbers from both localStorage (today) and
 * permanent DynamoDB Player records. Deduplicates by normalized phone number
 * so SMS campaigns can reach every player who ever provided a phone.
 */
export async function getAllPlayersWithPhones(): Promise<{ name: string; phone: string }[]> {
  const { getAllPlayersLocal } = await import('./localStoragePlayers');
  const localPlayers = getAllPlayersLocal();

  // Start with local players (today's session)
  const byPhone = new Map<string, { name: string; phone: string }>();
  for (const p of localPlayers) {
    if (p.phone?.trim()) {
      const normalized = p.phone.replace(/\D/g, '');
      if (normalized.length >= 10) {
        byPhone.set(normalized, { name: p.nick || p.name, phone: p.phone.trim() });
      }
    }
  }

  // Merge with permanent DynamoDB Player records
  try {
    const { getAllPlayers } = await import('./api');
    const dbPlayers = await getAllPlayers();
    for (const p of dbPlayers) {
      if (p.phone?.trim()) {
        const normalized = p.phone.replace(/\D/g, '');
        if (normalized.length >= 10 && !byPhone.has(normalized)) {
          byPhone.set(normalized, { name: p.nick || p.name, phone: p.phone.trim() });
        }
      }
    }
  } catch (error) {
    log('[SMS] Could not load DynamoDB players for campaign, using local only:', error);
  }

  return Array.from(byPhone.values());
}

/**
 * Send marketing SMS to multiple players
 */
export async function sendMarketingSMS(players: { name: string; phone: string }[], message: string): Promise<{ sent: number; failed: number; errors: string[] }> {
  const settings = getSMSSettings();
  if (!settings.enabled || !settings.apiKey) {
    throw new Error('SMS is not enabled or API key is not set');
  }

  if (!message.trim()) {
    throw new Error('Marketing message cannot be empty');
  }

  console.log('Sending marketing SMS to players:', players.length);
  console.log('Players:', players);

  const results: SMSResult[] = [];
  const errors: string[] = [];

  for (const player of players) {
    try {
      const personalizedMessage = message.replace(/{name}/g, player.name);
      const result = await sendSMS({
        to: player.phone,
        message: personalizedMessage,
      }, settings.apiKey);
      
      results.push(result);
      
      if (!result.success) {
        errors.push(`Failed to send to ${player.name} (${player.phone}): ${result.error}`);
      }
    } catch (error) {
      const errorMsg = `Error sending to ${player.name} (${player.phone}): ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      results.push({ success: false, error: errorMsg });
    }
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.length - sent;

  // Update last marketing sent time
  saveSMSSettings({
    ...settings,
    lastMarketingSent: new Date().toISOString(),
  });

  log(`📊 Marketing SMS results: ${sent} sent, ${failed} failed`);
  
  return { sent, failed, errors };
}

/**
 * Validate phone number format (basic validation for US numbers)
 */
export function validatePhoneNumber(phone: string): boolean {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Check if it's a valid US phone number (10 digits, optionally with country code)
  return cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'));
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  
  return phone; // Return original if format is unexpected
}

/**
 * Create a new scheduled campaign
 */
export function createScheduledCampaign(campaign: Omit<ScheduledCampaign, 'id' | 'createdAt'>): ScheduledCampaign {
  const settings = getSMSSettings();
  const newCampaign: ScheduledCampaign = {
    ...campaign,
    id: generateCampaignId(),
    createdAt: new Date().toISOString(),
  };
  
  const campaigns = settings.scheduledCampaigns || [];
  campaigns.push(newCampaign);
  
  saveSMSSettings({
    ...settings,
    scheduledCampaigns: campaigns,
  });
  
  log(`✅ Created scheduled campaign: ${newCampaign.name}`);
  return newCampaign;
}

/**
 * Get all scheduled campaigns
 */
export function getScheduledCampaigns(): ScheduledCampaign[] {
  const settings = getSMSSettings();
  return settings.scheduledCampaigns || [];
}

/**
 * Update a scheduled campaign
 */
export function updateScheduledCampaign(id: string, updates: Partial<ScheduledCampaign>): ScheduledCampaign | null {
  const settings = getSMSSettings();
  const campaigns = settings.scheduledCampaigns || [];
  const index = campaigns.findIndex(c => c.id === id);
  
  if (index === -1) return null;
  
  campaigns[index] = {
    ...campaigns[index],
    ...updates,
  };
  
  saveSMSSettings({
    ...settings,
    scheduledCampaigns: campaigns,
  });
  
  log(`✅ Updated scheduled campaign: ${id}`);
  return campaigns[index];
}

/**
 * Delete a scheduled campaign
 */
export function deleteScheduledCampaign(id: string): boolean {
  const settings = getSMSSettings();
  const campaigns = settings.scheduledCampaigns || [];
  const filtered = campaigns.filter(c => c.id !== id);
  
  if (filtered.length === campaigns.length) return false;
  
  saveSMSSettings({
    ...settings,
    scheduledCampaigns: filtered,
  });
  
  log(`✅ Deleted scheduled campaign: ${id}`);
  return true;
}

/**
 * Send a scheduled campaign immediately with improved tracking
 */
export async function sendScheduledCampaign(campaign: ScheduledCampaign): Promise<{ sent: number; failed: number; errors: string[] }> {
  const players = await getAllPlayersWithPhones();
  
  console.log('Players with phones for campaign:', players.length);
  
  if (players.length === 0) {
    return { sent: 0, failed: 0, errors: ['No players with phone numbers found'] };
  }

  // Update campaign with target count
  const targetCount = players.length;
  updateScheduledCampaign(campaign.id, { targetCount });

  try {
    const results = await sendMarketingSMS(players, campaign.message);
    
    // Mark campaign as sent with detailed results
    updateScheduledCampaign(campaign.id, {
      sentAt: new Date().toISOString(),
      isActive: false,
      sentCount: results.sent,
      failedCount: results.failed,
      errors: results.errors,
    });
    
    return results;
  } catch (error) {
    // Update campaign with error information
    updateScheduledCampaign(campaign.id, {
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    });
    
    throw error;
  }
}

/**
 * Generate a unique campaign ID
 */
function generateCampaignId(): string {
  return `campaign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Save a campaign as a template for future use
 */
export function saveCampaignTemplate(template: Omit<ScheduledCampaign, 'id' | 'createdAt' | 'sentAt' | 'targetCount' | 'sentCount' | 'failedCount' | 'errors' | 'isActive'>): ScheduledCampaign {
  const settings = getSMSSettings();
  const templates = settings.campaignTemplates || [];
  
  const newTemplate: ScheduledCampaign = {
    ...template,
    id: `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    isTemplate: true,
    isActive: false, // Templates are never active by default
  };
  
  templates.push(newTemplate);
  
  saveSMSSettings({
    ...settings,
    campaignTemplates: templates,
  });
  
  log(`✅ Saved campaign template: ${newTemplate.name}`);
  return newTemplate;
}

/**
 * Get all saved campaign templates
 */
export function getCampaignTemplates(): ScheduledCampaign[] {
  const settings = getSMSSettings();
  return settings.campaignTemplates || [];
}

/**
 * Delete a campaign template
 */
export function deleteCampaignTemplate(id: string): boolean {
  const settings = getSMSSettings();
  const templates = settings.campaignTemplates || [];
  const filtered = templates.filter(t => t.id !== id);
  
  if (filtered.length === templates.length) return false;
  
  saveSMSSettings({
    ...settings,
    campaignTemplates: filtered,
  });
  
  log(`✅ Deleted campaign template: ${id}`);
  return true;
}

/**
 * Create a new campaign from a template
 */
export function createCampaignFromTemplate(templateId: string, scheduledDate: string, scheduledTime: string): ScheduledCampaign | null {
  const templates = getCampaignTemplates();
  const template = templates.find(t => t.id === templateId);
  
  if (!template) return null;
  
  const campaign = createScheduledCampaign({
    name: template.name,
    message: template.message,
    scheduledDate,
    scheduledTime,
    isActive: true,
  });
  
  // Update template's last used time
  updateCampaignTemplate(templateId, { lastUsed: new Date().toISOString() });
  
  log(`✅ Created campaign from template: ${template.name}`);
  return campaign;
}

/**
 * Update a campaign template
 */
export function updateCampaignTemplate(id: string, updates: Partial<ScheduledCampaign>): ScheduledCampaign | null {
  const settings = getSMSSettings();
  const templates = settings.campaignTemplates || [];
  const index = templates.findIndex(t => t.id === id);
  
  if (index === -1) return null;
  
  templates[index] = {
    ...templates[index],
    ...updates,
  };
  
  saveSMSSettings({
    ...settings,
    campaignTemplates: templates,
  });
  
  log(`✅ Updated campaign template: ${id}`);
  return templates[index];
}

/**
 * Extend SMSSettings interface to include campaign templates
 */
declare module './sms' {
  interface SMSSettings {
    enabled: boolean;
    apiKey: string;
    checkInNotifications: boolean;
    marketingMessages: boolean;
    marketingMessage?: string;
    lastMarketingSent?: string;
    scheduledCampaigns?: ScheduledCampaign[];
    campaignTemplates?: ScheduledCampaign[];
  }
}
