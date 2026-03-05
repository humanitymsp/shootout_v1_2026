import { useState, useEffect } from 'react';
import { getSMSSettings, saveSMSSettings, syncSMSKeyToDB, sendMarketingSMS, getAllPlayersWithPhones, getScheduledCampaigns, createScheduledCampaign, deleteScheduledCampaign, sendScheduledCampaign, saveCampaignTemplate, getCampaignTemplates, deleteCampaignTemplate, createCampaignFromTemplate } from '../lib/sms';
import { showToast } from './Toast';
import { log } from '../lib/logger';
import type { SMSSettings, ScheduledCampaign } from '../lib/sms';
import './SMSSettingsModal.css';

interface SMSSettingsModalProps {
  onClose: () => void;
}

export default function SMSSettingsModal({ onClose }: SMSSettingsModalProps) {
  const [settings, setSettings] = useState<SMSSettings>({
    enabled: false,
    apiKey: '',
    checkInNotifications: false,
    marketingMessages: false,
    marketingMessage: '',
  });
  const [isTesting, setIsTesting] = useState(false);
  const [isSendingMarketing, setIsSendingMarketing] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [campaigns, setCampaigns] = useState<ScheduledCampaign[]>([]);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    message: '',
    scheduledDate: '',
    scheduledTime: '',
  });
  const [templates, setTemplates] = useState<ScheduledCampaign[]>([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    message: '',
  });
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);

  useEffect(() => {
    const currentSettings = getSMSSettings();
    setSettings(currentSettings);
    setCampaigns(getScheduledCampaigns());
    setTemplates(getCampaignTemplates());
  }, []);

  const handleCreateCampaign = () => {
    if (!newCampaign.name || !newCampaign.message || !newCampaign.scheduledDate || !newCampaign.scheduledTime) {
      showToast('Please fill in all campaign fields', 'error');
      return;
    }

    try {
      const campaign = createScheduledCampaign({
        name: newCampaign.name,
        message: newCampaign.message,
        scheduledDate: newCampaign.scheduledDate,
        scheduledTime: newCampaign.scheduledTime,
        isActive: true,
      });
      
      setCampaigns(getScheduledCampaigns());
      setNewCampaign({ name: '', message: '', scheduledDate: '', scheduledTime: '' });
      setShowCampaignForm(false);
      showToast(`Campaign "${campaign.name}" created successfully`, 'success');
    } catch (error) {
      showToast('Failed to create campaign', 'error');
    }
  };

  const handleCreateTemplate = () => {
    if (!newTemplate.name || !newTemplate.message) {
      showToast('Please fill in template name and message', 'error');
      return;
    }

    try {
      const template = saveCampaignTemplate({
        name: newTemplate.name,
        message: newTemplate.message,
        scheduledDate: '', // Templates don't have scheduled dates
        scheduledTime: '', // Templates don't have scheduled times
      });
      
      setTemplates(getCampaignTemplates());
      setNewTemplate({ name: '', message: '' });
      setShowTemplateForm(false);
      showToast(`Template "${template.name}" saved successfully`, 'success');
    } catch (error) {
      showToast('Failed to save template', 'error');
    }
  };

  const handleCreateFromTemplate = (templateId: string) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const defaultDate = tomorrow.toISOString().split('T')[0];
    const defaultTime = '12:00';
    
    const campaign = createCampaignFromTemplate(templateId, defaultDate, defaultTime);
    
    if (campaign) {
      setNewCampaign({
        name: campaign.name,
        message: campaign.message,
        scheduledDate: campaign.scheduledDate,
        scheduledTime: campaign.scheduledTime,
      });
      setShowCampaignForm(true);
      setShowTemplateSelector(false);
      showToast(`Campaign created from template`, 'success');
    }
  };

  const handleDeleteTemplate = (id: string) => {
    if (window.confirm('Are you sure you want to delete this template?')) {
      try {
        deleteCampaignTemplate(id);
        setTemplates(getCampaignTemplates());
        showToast('Template deleted successfully', 'success');
      } catch (error) {
        showToast('Failed to delete template', 'error');
      }
    }
  };

  const handleDeleteCampaign = (id: string) => {
    if (window.confirm('Are you sure you want to delete this campaign?')) {
      try {
        deleteScheduledCampaign(id);
        setCampaigns(getScheduledCampaigns());
        showToast('Campaign deleted successfully', 'success');
      } catch (error) {
        showToast('Failed to delete campaign', 'error');
      }
    }
  };

  const handleSendCampaignNow = async (campaign: ScheduledCampaign) => {
    if (!window.confirm(`Send campaign "${campaign.name}" to all players now?`)) {
      return;
    }

    try {
      const results = await sendScheduledCampaign(campaign);
      setCampaigns(getScheduledCampaigns());
      
      if (results.sent > 0) {
        showToast(`Campaign sent to ${results.sent} players`, 'success');
      }
      
      if (results.failed > 0) {
        showToast(`${results.failed} messages failed`, 'error');
      }
    } catch (error) {
      showToast('Failed to send campaign', 'error');
    }
  };

  const handleSave = () => {
    saveSMSSettings(settings);
    // Sync API key to DynamoDB so public page on other devices can send SMS
    syncSMSKeyToDB();
    showToast('SMS settings saved successfully', 'success');
    onClose();
  };

  const handleTestSMS = async () => {
    if (!testPhoneNumber || !settings.apiKey) {
      showToast('Please enter a test phone number and API key', 'error');
      return;
    }

    // Use the default marketing message for testing, or fallback to "test SMS"
    const testMessage = (settings.marketingMessage || '').trim() || 'test SMS';

    setIsTesting(true);
    try {
      const { sendSMS } = await import('../lib/sms');
      const result = await sendSMS(
        {
          to: testPhoneNumber,
          message: testMessage,
        },
        settings.apiKey
      );

      if (result.success) {
        const quota = result.quotaRemaining !== undefined ? ` | quota: ${result.quotaRemaining}` : '';
        const debug = result.error || '';
        showToast(`SMS sent! ${debug}${quota}`, 'success');
      } else {
        showToast(`Test SMS failed: ${result.error}`, 'error');
      }
    } catch (error) {
      showToast('Failed to send test SMS', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSendMarketing = async () => {
    if (!settings.marketingMessage) {
      showToast('Please enter a marketing message', 'error');
      return;
    }

    setIsSendingMarketing(true);
    try {
      const players = await getAllPlayersWithPhones();

      if (players.length === 0) {
        showToast('No players with phone numbers found', 'error');
        setIsSendingMarketing(false);
        return;
      }

      const results = await sendMarketingSMS(players, settings.marketingMessage);
      
      if (results.sent > 0) {
        showToast(`Marketing SMS sent to ${results.sent} players`, 'success');
      }
      
      if (results.failed > 0) {
        showToast(`${results.failed} messages failed`, 'error');
        log('Marketing SMS errors:', results.errors);
      }
    } catch (error) {
      showToast('Failed to send marketing messages', 'error');
    } finally {
      setIsSendingMarketing(false);
    }
  };

  // Player count for campaigns (loaded from merged local + DB source)
  const [playerCount, setPlayerCount] = useState(0);
  useEffect(() => {
    getAllPlayersWithPhones().then(p => setPlayerCount(p.length)).catch(() => {});
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal-content sms-settings-modal">
        <div className="modal-header">
          <h2>SMS Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Enable SMS Features
            </label>
            <p className="form-help">Toggle all SMS functionality on/off</p>
          </div>

          {settings.enabled && (
            <>
              <div className="form-group">
                <label>TextBelt API Key</label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder="Enter your TextBelt API key"
                  className="api-key-input"
                />
                <p className="form-help">
                  Get your API key from{' '}
                  <a href="https://textbelt.com/" target="_blank" rel="noopener noreferrer">
                    textbelt.com
                  </a>
                </p>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.checkInNotifications}
                    onChange={(e) => setSettings({ ...settings, checkInNotifications: e.target.checked })}
                  />
                  Check-in Notifications
                </label>
                <p className="form-help">
                  Send SMS to players when they are checked in or added to waitlist
                </p>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.marketingMessages}
                    onChange={(e) => setSettings({ ...settings, marketingMessages: e.target.checked })}
                  />
                  Marketing Messages
                </label>
                <p className="form-help">
                  Enable periodic marketing messages to players with phone numbers
                </p>
              </div>

              <div className="form-group">
                <label>Default Marketing Message</label>
                <textarea
                  value={settings.marketingMessage || ''}
                  onChange={(e) => setSettings({ ...settings, marketingMessage: e.target.value })}
                  placeholder="Enter your default marketing message. Use {name} to personalize."
                  rows={3}
                />
                <p className="form-help">
                  Use {'{name}'} as a placeholder for the player's name
                </p>
              </div>

              <div className="form-group">
                <label>Test Marketing Message</label>
                <div className="test-sms-container">
                  <input
                    type="tel"
                    value={testPhoneNumber}
                    onChange={(e) => setTestPhoneNumber(e.target.value)}
                    placeholder="Enter phone number to test marketing message"
                    className="test-phone-input"
                  />
                  <button
                    onClick={handleTestSMS}
                    disabled={isTesting || !testPhoneNumber || !settings.apiKey}
                    className="test-button"
                  >
                    {isTesting ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
                <p className="form-help">
                  Sends your default marketing message to test number. If no marketing message is set, sends "test SMS".
                </p>
              </div>

              <div className="form-group">
                <label>Send Marketing Message</label>
                <button
                  onClick={handleSendMarketing}
                  disabled={isSendingMarketing || !settings.marketingMessage || playerCount === 0}
                  className="marketing-button"
                >
                  {isSendingMarketing ? 'Sending...' : `Send to ${playerCount} Players`}
                </button>
                <p className="form-help">
                  This will send the marketing message to all players with phone numbers
                </p>
              </div>
            </>
          )}

          {/* Campaign Scheduling Section */}
          {settings.enabled && settings.marketingMessages && (
            <div className="campaign-section">
            <h3>Scheduled Campaigns</h3>
            
            <div className="campaign-actions-row">
              <button 
                onClick={() => setShowCampaignForm(true)}
                className="create-campaign-button"
              >
                + New Campaign
              </button>
              <button 
                onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                className="template-button"
              >
                📋 Use Template
              </button>
              <button 
                onClick={() => setShowTemplateForm(true)}
                className="save-template-button"
              >
                💾 Save as Template
              </button>
            </div>

            {/* Template Selector */}
            {showTemplateSelector && (
              <div className="template-selector">
                <h4>Select a Template</h4>
                {templates.length === 0 ? (
                  <p className="no-templates">No saved templates available</p>
                ) : (
                  <div className="template-list">
                    {templates.map((template) => (
                      <div key={template.id} className="template-item">
                        <div className="template-info">
                          <h5>{template.name}</h5>
                          <p>{template.message}</p>
                          {template.lastUsed && (
                            <span className="last-used">Last used: {new Date(template.lastUsed).toLocaleDateString()}</span>
                          )}
                        </div>
                        <div className="template-actions">
                          <button 
                            onClick={() => handleCreateFromTemplate(template.id)}
                            className="use-template-button"
                          >
                            Use
                          </button>
                          <button 
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="delete-template-button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save Template Form */}
            {showTemplateForm && (
              <div className="template-form">
                <h4>Save Campaign Template</h4>
                <div className="form-group">
                  <label>Template Name</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="e.g., Weekend Tournament"
                  />
                </div>
                <div className="form-group">
                  <label>Message</label>
                  <textarea
                    value={newTemplate.message}
                    onChange={(e) => setNewTemplate({ ...newTemplate, message: e.target.value })}
                    placeholder="Enter your campaign message. Use {name} to personalize."
                    rows={3}
                  />
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowTemplateForm(false)} className="cancel-button">
                    Cancel
                  </button>
                  <button onClick={handleCreateTemplate} className="save-button">
                    Save Template
                  </button>
                </div>
              </div>
            )}

            {showCampaignForm && (
              <div className="campaign-form">
                <h4>Create New Campaign</h4>
                <div className="form-group">
                  <label>Campaign Name</label>
                  <input
                    type="text"
                    value={newCampaign.name}
                    onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                    placeholder="e.g., Weekend Tournament"
                  />
                </div>
                <div className="form-group">
                  <label>Message</label>
                  <textarea
                    value={newCampaign.message}
                    onChange={(e) => setNewCampaign({ ...newCampaign, message: e.target.value })}
                    placeholder="Enter your campaign message. Use {name} to personalize."
                    rows={3}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={newCampaign.scheduledDate}
                      onChange={(e) => setNewCampaign({ ...newCampaign, scheduledDate: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Time</label>
                    <input
                      type="time"
                      value={newCampaign.scheduledTime}
                      onChange={(e) => setNewCampaign({ ...newCampaign, scheduledTime: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button onClick={() => setShowCampaignForm(false)} className="cancel-button">
                    Cancel
                  </button>
                  <button onClick={handleCreateCampaign} className="save-button">
                    Create Campaign
                  </button>
                </div>
              </div>
            )}

            <div className="campaign-list">
              {campaigns.length === 0 ? (
                <p className="no-campaigns">No scheduled campaigns</p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.id} className="campaign-item">
                    <div className="campaign-info">
                      <h4>{campaign.name}</h4>
                      <p>{campaign.message}</p>
                      <div className="campaign-details">
                        <span>Scheduled: {campaign.scheduledDate} at {campaign.scheduledTime}</span>
                        <span className={`status ${campaign.isActive ? 'active' : 'sent'}`}>
                          {campaign.isActive ? 'Active' : 'Sent'}
                        </span>
                        <span className="player-count">
                          Targets {playerCount} players
                        </span>
                        {campaign.sentAt && (
                          <span>Sent: {new Date(campaign.sentAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="campaign-actions">
                      {campaign.isActive && (
                        <button 
                          onClick={() => handleSendCampaignNow(campaign)}
                          className="send-now-button"
                        >
                          Send Now
                        </button>
                      )}
                      <button 
                        onClick={() => handleDeleteCampaign(campaign.id)}
                        className="delete-button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-button">
            Cancel
          </button>
          <button onClick={handleSave} className="save-button">
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
