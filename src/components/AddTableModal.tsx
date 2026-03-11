import { useState } from 'react';
import { createTable } from '../lib/api';
import { createPersistentTable } from '../lib/persistentTables';
import type { PokerTable } from '../types';
import './AddTableModal.css';

interface AddTableModalProps {
  clubDayId: string;
  existingTableNumbers: number[];
  adminUser: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TABLE_TEMPLATES = [
  { name: 'NLH 1/2', gameType: 'NLH' as const, stakesText: '$1/$2 No Limit', seatsTotal: 9, buyInLimits: '$40-$400', bombPotCount: 1 },
  { name: 'NLH 1/3', gameType: 'NLH' as const, stakesText: '$1/$3 No Limit', seatsTotal: 9, buyInLimits: '$300-$1000', bombPotCount: 1 },
  { name: 'NLH 1/2/5', gameType: 'NLH' as const, stakesText: '$1/$2/$5 No Limit', seatsTotal: 9, buyInLimits: '$200-$1000', bombPotCount: 1 },
  { name: 'NLH 2/5', gameType: 'NLH' as const, stakesText: '$2/$5 No Limit', seatsTotal: 9, buyInLimits: '$200-$1000', bombPotCount: 1 },
  { name: 'PLO', gameType: 'PLO' as const, stakesText: 'PLO', seatsTotal: 9, buyInLimits: '$200-$1000', bombPotCount: 1 },
  { name: 'Big-O', gameType: 'BigO' as const, stakesText: 'Big-O', seatsTotal: 9, buyInLimits: 'See Floor', bombPotCount: 1 },
  { name: 'Limit', gameType: 'Limit' as const, stakesText: 'Limit', seatsTotal: 9, buyInLimits: 'See Floor', bombPotCount: 1 },
  { name: 'Mixed', gameType: 'Mixed' as const, stakesText: 'Mixed', seatsTotal: 9, buyInLimits: 'See Floor', bombPotCount: 1 },
];

const STAKES_OPTIONS = [
  '$1/$2 No Limit',
  '$1/$3 No Limit',
  '$2/$5 No Limit',
  '$1/$2/$5 No Limit',
  '$5/$10 No Limit',
  '$10/$20 No Limit',
  '$25/$50 No Limit',
  'PLO $1/$2',
  'PLO $2/$5',
  'PLO $5/$10',
  'Big-O $1/$2',
  'Big-O $2/$5',
  'Limit $2/$4',
  'Limit $4/$8',
  'Limit $6/$12',
  'Mixed',
  'Custom',
];

const BUY_IN_LIMITS_OPTIONS = [
  '$40-$400',
  '$100-$500',
  '$200-$1000',
  '$300-$1000',
  '$500-$2000',
  '$1000-$5000',
  'See Floor',
  'Custom',
];

export default function AddTableModal({
  clubDayId,
  existingTableNumbers,
  adminUser: _adminUser,
  onClose,
  onSuccess,
}: AddTableModalProps) {
  const availableTableNumbers = Array.from({ length: 30 }, (_, i) => i + 1).filter(
    (n) => !existingTableNumbers.includes(n)
  );
  
  // Initialize tableNumber to the first available number, or 1 if all are taken
  const [selectedTableNumbers, setSelectedTableNumbers] = useState<number[]>([availableTableNumbers[0] || 1]);
  const [tableQuantity, setTableQuantity] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [gameType, setGameType] = useState<PokerTable['game_type']>('NLH');
  const [stakesText, setStakesText] = useState('');
  const [selectedStakes, setSelectedStakes] = useState<string>('');
  const [showCustomStakes, setShowCustomStakes] = useState(false);
  const [seatsTotal, setSeatsTotal] = useState(9);
  const [bombPotCount, setBombPotCount] = useState(1);
  const [lockoutCount, setLockoutCount] = useState(0);
  const [buyInLimits, setBuyInLimits] = useState('');
  const [selectedBuyInLimits, setSelectedBuyInLimits] = useState<string>('');
  const [showCustomBuyInLimits, setShowCustomBuyInLimits] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creationProgress, setCreationProgress] = useState<{ current: number; total: number } | null>(null);
  
  // Persistent table options
  const [isPersistent, setIsPersistent] = useState(false);
  const [publicSignups, setPublicSignups] = useState(false);

  // Update selected table numbers when quantity changes
  const handleQuantityChange = (qty: number) => {
    const newQty = Math.min(qty, availableTableNumbers.length);
    setTableQuantity(newQty);
    // Auto-select the first N available table numbers
    setSelectedTableNumbers(availableTableNumbers.slice(0, newQty));
  };

  // Toggle a specific table number selection
  const toggleTableNumber = (num: number) => {
    if (selectedTableNumbers.includes(num)) {
      // Don't allow deselecting the last one
      if (selectedTableNumbers.length > 1) {
        setSelectedTableNumbers(prev => prev.filter(n => n !== num));
        setTableQuantity(prev => prev - 1);
      }
    } else if (tableQuantity === 1) {
      // When quantity is 1, replace the current selection instead of adding
      setSelectedTableNumbers([num]);
    } else {
      setSelectedTableNumbers(prev => [...prev, num].sort((a, b) => a - b));
      setTableQuantity(prev => prev + 1);
    }
  };

  const handleTemplateSelect = (templateName: string) => {
    const template = TABLE_TEMPLATES.find((t) => t.name === templateName);
    if (template) {
      setSelectedTemplate(templateName);
      setGameType(template.gameType);
      setStakesText(template.stakesText);
      setSelectedStakes(template.stakesText);
      setShowCustomStakes(false);
      setSeatsTotal(template.seatsTotal);
      setBombPotCount(template.bombPotCount);
      setLockoutCount(0);
      setBuyInLimits(template.buyInLimits || '');
      setSelectedBuyInLimits(template.buyInLimits || '');
      setShowCustomBuyInLimits(false);
    }
  };

  const handleStakesChange = (value: string) => {
    setSelectedStakes(value);
    if (value === 'Custom') {
      setShowCustomStakes(true);
      setStakesText('');
    } else {
      setShowCustomStakes(false);
      setStakesText(value);
    }
  };

  const handleCustomSetup = () => {
    setSelectedTemplate('custom');
    setGameType('NLH');
    setStakesText('');
    setSelectedStakes(''); // Start with empty selection so dropdown is visible
    setShowCustomStakes(false); // Don't show custom input until "Custom" is selected
    setSeatsTotal(9);
    setBombPotCount(1);
    setLockoutCount(0);
    setBuyInLimits('');
    setSelectedBuyInLimits(''); // Start with empty selection
    setShowCustomBuyInLimits(false); // Don't show custom input until "Custom" is selected
    setShowAdvanced(true); // Always show advanced for custom
  };

  const handleBuyInLimitsChange = (value: string) => {
    setSelectedBuyInLimits(value);
    if (value === 'Custom') {
      setShowCustomBuyInLimits(true);
      setBuyInLimits('');
    } else {
      setShowCustomBuyInLimits(false);
      setBuyInLimits(value);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!selectedTemplate) {
      setError('Please select a table template');
      return;
    }

    // Validate that all selected table numbers are available
    const unavailableNumbers = selectedTableNumbers.filter(n => !availableTableNumbers.includes(n));
    if (unavailableNumbers.length > 0) {
      setError(`Table(s) ${unavailableNumbers.join(', ')} already exist. Please select different table numbers.`);
      return;
    }

    if (selectedTableNumbers.length === 0) {
      setError('Please select at least one table number');
      return;
    }

    if (!selectedStakes || (selectedStakes === 'Custom' && !stakesText.trim())) {
      setError('Stakes text is required');
      return;
    }
    
    // Ensure stakesText is set from dropdown if not custom
    const finalStakesText = selectedStakes === 'Custom' ? stakesText.trim() : selectedStakes;
    if (!finalStakesText) {
      setError('Please select or enter stakes');
      return;
    }

    if (seatsTotal < 1 || seatsTotal > 20) {
      setError('Tables must have between 1 and 20 seats');
      return;
    }

    if (publicSignups && !isPersistent) {
      setError('Public signups are only available for persistent tables');
      return;
    }

    setLoading(true);
    setError('');
    setCreationProgress({ current: 0, total: selectedTableNumbers.length });

    try {
      // Create tables via the API (persistent or not — they're real PokerTable records)
      for (let i = 0; i < selectedTableNumbers.length; i++) {
        const tableNumber = selectedTableNumbers[i];
        setCreationProgress({ current: i + 1, total: selectedTableNumbers.length });
        
        const newTable = await createTable({
          clubDayId: clubDayId,
          tableNumber: tableNumber,
          gameType: gameType,
          stakesText: finalStakesText,
          seatsTotal: seatsTotal,
          bombPotCount: bombPotCount,
          lockoutCount: lockoutCount,
          buyInLimits: buyInLimits || selectedBuyInLimits,
        });

        // If persistent, also save metadata to localStorage
        if (isPersistent) {
          createPersistentTable({
            table_number: tableNumber,
            game_type: gameType,
            stakes_text: finalStakesText,
            seats_total: seatsTotal,
            bomb_pot_count: bombPotCount,
            lockout_count: lockoutCount,
            buy_in_limits: buyInLimits || selectedBuyInLimits,
            show_on_tv: false,
            public_signups: publicSignups,
            status: 'OPEN',
            api_table_id: newTable.id,
          });
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create table(s)');
      setLoading(false);
      setCreationProgress(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content add-table-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Table</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-message">{error}</div>}

          {!selectedTemplate ? (
            <div className="template-selection">
              <p className="template-instruction">Select a table template:</p>
              <div className="template-grid">
                {TABLE_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    className="template-card"
                    onClick={() => handleTemplateSelect(template.name)}
                  >
                    <div className="template-name">{template.name}</div>
                    <div className="template-details">
                      {template.stakesText}
                      {template.buyInLimits && <span className="buy-in"> • {template.buyInLimits}</span>}
                    </div>
                  </button>
                ))}
                <button
                  type="button"
                  className="template-card custom-template"
                  onClick={handleCustomSetup}
                >
                  <div className="template-name">Custom</div>
                  <div className="template-details">Set up manually</div>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="table-form">
              <div className="form-two-col">
                {/* ── LEFT COLUMN: Quantity + Table Numbers ── */}
                <div className="form-col-left">
                  {/* Quantity and Template Row */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>How Many Tables?</label>
                      <div className="quantity-selector">
                        <button 
                          type="button" 
                          className="qty-btn"
                          onClick={() => handleQuantityChange(Math.max(1, tableQuantity - 1))}
                          disabled={tableQuantity <= 1}
                        >
                          −
                        </button>
                        <span className="qty-value">{tableQuantity}</span>
                        <button 
                          type="button" 
                          className="qty-btn"
                          onClick={() => handleQuantityChange(Math.min(availableTableNumbers.length, tableQuantity + 1))}
                          disabled={tableQuantity >= availableTableNumbers.length}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {selectedTemplate !== 'custom' && (
                      <div className="form-group">
                        <label>Template</label>
                        <div className="template-display">
                          {selectedTemplate}
                          <button
                            type="button"
                            className="change-template-btn"
                            onClick={() => {
                              setSelectedTemplate(null);
                              setShowAdvanced(false);
                            }}
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Table Number Selection */}
                  <div className="form-group">
                    <label>Table Number{tableQuantity > 1 ? 's' : ''} <span className="selected-count">({selectedTableNumbers.length} selected)</span></label>
                    <div className="table-number-grid">
                      {availableTableNumbers.slice(0, 20).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`table-number-btn ${selectedTableNumbers.includes(n) ? 'selected' : ''}`}
                          onClick={() => toggleTableNumber(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    {selectedTableNumbers.length > 0 && (
                      <div className="selected-tables-preview">
                        Creating: {selectedTableNumbers.map(n => `Table ${n}`).join(', ')}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── RIGHT COLUMN: Game Settings + Options ── */}
                <div className="form-col-right">
                  <div className="form-group">
                    <label>Buy-in Limits <span className="required">*</span></label>
                    <select
                      value={selectedBuyInLimits}
                      onChange={(e) => handleBuyInLimitsChange(e.target.value)}
                      required
                    >
                      <option value="">Select buy-in limits</option>
                      {BUY_IN_LIMITS_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {showCustomBuyInLimits && (
                      <input
                        type="text"
                        value={buyInLimits}
                        onChange={(e) => setBuyInLimits(e.target.value)}
                        placeholder="Enter custom buy-in limits"
                        required={showCustomBuyInLimits}
                        style={{ marginTop: '0.35rem' }}
                      />
                    )}
                    <small>Required for all tables</small>
                  </div>

                  {/* Game settings: custom / advanced / preview */}
                  {selectedTemplate === 'custom' ? (
                    <>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Game Type <span className="required">*</span></label>
                          <select
                            value={gameType}
                            onChange={(e) => setGameType(e.target.value as PokerTable['game_type'])}
                            required
                          >
                            <option value="NLH">NLH</option>
                            <option value="BigO">Big-O</option>
                            <option value="Limit">Limit</option>
                            <option value="PLO">PLO</option>
                            <option value="Mixed">Mixed</option>
                            <option value="Custom">Custom</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Seats <span className="required">*</span></label>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={seatsTotal}
                            onChange={(e) => setSeatsTotal(parseInt(e.target.value) || 9)}
                            required
                          />
                        </div>

                        <div className="form-group">
                          <label>Bomb Pots</label>
                          <select
                            value={bombPotCount}
                            onChange={(e) => setBombPotCount(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Lockouts</label>
                          <select
                            value={lockoutCount}
                            onChange={(e) => setLockoutCount(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Stakes/Blind Levels <span className="required">*</span></label>
                        <select
                          value={selectedStakes}
                          onChange={(e) => handleStakesChange(e.target.value)}
                          required={selectedTemplate === 'custom'}
                        >
                          <option value="">Select stakes</option>
                          {STAKES_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        {showCustomStakes && (
                          <input
                            type="text"
                            value={stakesText}
                            onChange={(e) => setStakesText(e.target.value)}
                            placeholder="Enter custom stakes (e.g., $1/$2 No Limit, $2/$5 PLO)"
                            required={showCustomStakes}
                            style={{ marginTop: '0.35rem' }}
                          />
                        )}
                        <small>Select from options above, or choose "Custom" to enter your own</small>
                      </div>
                    </>
                  ) : showAdvanced ? (
                    <>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Game Type</label>
                          <select
                            value={gameType}
                            onChange={(e) => setGameType(e.target.value as PokerTable['game_type'])}
                            required
                          >
                            <option value="NLH">NLH</option>
                            <option value="BigO">Big-O</option>
                            <option value="Limit">Limit</option>
                            <option value="PLO">PLO</option>
                            <option value="Mixed">Mixed</option>
                            <option value="Custom">Custom</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Seats</label>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={seatsTotal}
                            onChange={(e) => setSeatsTotal(parseInt(e.target.value) || 9)}
                            required
                          />
                        </div>

                        <div className="form-group">
                          <label>Bomb Pots</label>
                          <select
                            value={bombPotCount}
                            onChange={(e) => setBombPotCount(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Lockouts</label>
                          <select
                            value={lockoutCount}
                            onChange={(e) => setLockoutCount(parseInt(e.target.value))}
                          >
                            {Array.from({ length: 4 }, (_, i) => i).map((value) => (
                              <option key={value} value={value}>{value}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Stakes Text</label>
                        <select
                          value={selectedStakes}
                          onChange={(e) => handleStakesChange(e.target.value)}
                          required
                        >
                          <option value="">Select stakes</option>
                          {STAKES_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        {showCustomStakes && (
                          <input
                            type="text"
                            value={stakesText}
                            onChange={(e) => setStakesText(e.target.value)}
                            placeholder="Enter custom stakes"
                            required={showCustomStakes}
                            style={{ marginTop: '0.35rem' }}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="form-preview">
                      <div className="preview-item">
                        <span className="preview-label">Game:</span>
                        <span className="preview-value">{gameType}</span>
                      </div>
                      <div className="preview-item">
                        <span className="preview-label">Stakes:</span>
                        <span className="preview-value">{stakesText}</span>
                      </div>
                      <div className="preview-item">
                        <span className="preview-label">Buy-in:</span>
                        <span className="preview-value">{buyInLimits || 'Not set'}</span>
                      </div>
                      <div className="preview-item">
                        <span className="preview-label">Seats:</span>
                        <span className="preview-value">{seatsTotal}</span>
                      </div>
                      <div className="preview-item">
                        <span className="preview-label">Bomb Pots:</span>
                        <span className="preview-value">{bombPotCount}</span>
                      </div>
                      <button
                        type="button"
                        className="advanced-toggle"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                      >
                        {showAdvanced ? 'Hide' : 'Show'} Advanced Options
                      </button>
                    </div>
                  )}

                  {/* Persistent Table Options */}
                  {selectedTemplate && (
                    <div className="persistent-options-section">
                      <div className="form-group">
                        <div className="checkbox-group">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={isPersistent}
                              onChange={(e) => {
                                setIsPersistent(e.target.checked);
                                if (!e.target.checked) setPublicSignups(false);
                              }}
                            />
                            Persistent table (survives reset day)
                          </label>
                          <small>This table stays visible after daily reset</small>
                        </div>
                      </div>
                      {isPersistent && (
                        <div className="form-group">
                          <div className="checkbox-group">
                            <label className="checkbox-label">
                              <input
                                type="checkbox"
                                checked={publicSignups}
                                onChange={(e) => setPublicSignups(e.target.checked)}
                              />
                              Enable public waitlist signup
                            </label>
                            <small>Players can join from the public page using nickname and phone number</small>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </form>
          )}

          {selectedTemplate && (
            <div className="modal-actions">
              <button type="button" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button type="button" disabled={loading || selectedTableNumbers.length === 0} onClick={() => handleSubmit()}>
                {loading 
                  ? creationProgress 
                    ? `Creating ${creationProgress.current}/${creationProgress.total}...` 
                    : 'Creating...'
                  : selectedTableNumbers.length === 1 
                    ? 'Create Table' 
                    : `Create ${selectedTableNumbers.length} Tables`
                }
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
