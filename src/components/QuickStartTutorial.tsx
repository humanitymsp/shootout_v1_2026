import { useState } from 'react';
import './QuickStartTutorial.css';

interface QuickStartTutorialProps {
  onClose: () => void;
}

type TutorialStep = 'intro' | 'moving-players' | 'breaking-tables' | 'removing-tables' | 'reports' | 'complete';

export default function QuickStartTutorial({ onClose }: QuickStartTutorialProps) {
  const [currentStep, setCurrentStep] = useState<TutorialStep>('intro');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const steps: Record<TutorialStep, { title: string; content: JSX.Element }> = {
    intro: {
      title: 'Welcome to Final Table Poker Club!',
      content: (
        <div className="tutorial-content">
          <p className="tutorial-intro">
            This quick tutorial will show you how to perform the most important tasks in the system.
          </p>
          <div className="tutorial-features">
            <div className="feature-item">
              <span>Moving players between tables</span>
            </div>
            <div className="feature-item">
              <span>Breaking tables</span>
            </div>
            <div className="feature-item">
              <span>Removing tables</span>
            </div>
            <div className="feature-item">
              <span>Running reports</span>
            </div>
          </div>
          <p className="tutorial-note">
            This tutorial takes about 2 minutes. You can skip it anytime or disable it permanently.
          </p>
        </div>
      ),
    },
    'moving-players': {
      title: 'Moving Players Between Tables',
      content: (
        <div className="tutorial-content">
          <div className="tutorial-steps">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-text">
                <strong>Drag & Drop:</strong> Click and hold on a player's name, then drag them to another table's seat or waitlist area.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-text">
                <strong>Quick Move:</strong> Hover over a player to see quick move buttons (T8, T10, T14) for the top 3 other tables.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-text">
                <strong>Actions Menu:</strong> Use the "Actions" dropdown next to any player to move them to a specific table or waitlist.
              </div>
            </div>
          </div>
          <div className="tutorial-tip">
            💡 <strong>Tip:</strong> Players can be seated at one table AND waitlisted at another table simultaneously.
          </div>
        </div>
      ),
    },
    'breaking-tables': {
      title: 'Breaking Tables',
      content: (
        <div className="tutorial-content">
          <div className="tutorial-steps">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-text">
                <strong>Click "Break Table":</strong> Located in the header at the top of the page.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-text">
                <strong>Select Source Table:</strong> Choose the table you want to break (move all players from).
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-text">
                <strong>Choose Destination:</strong> Select where to move all players - another table or waitlist.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">4</div>
              <div className="step-text">
                <strong>Confirm:</strong> Review the move and confirm. The source table will be closed automatically.
              </div>
            </div>
          </div>
          <div className="tutorial-tip">
            💡 <strong>Tip:</strong> Breaking a table is perfect for consolidating players when a table gets too empty.
          </div>
        </div>
      ),
    },
    'removing-tables': {
      title: 'Removing Tables',
      content: (
        <div className="tutorial-content">
          <div className="tutorial-steps">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-text">
                <strong>Click "Remove Table":</strong> Found on each table card, below the "Seat Next" button.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-text">
                <strong>If Players Present:</strong> You'll be asked if you want to break the table first (move players) or delete with all players.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-text">
                <strong>Confirm Deletion:</strong> Confirm the removal. This action cannot be undone.
              </div>
            </div>
          </div>
          <div className="tutorial-tip">
            <strong>Warning:</strong> Removing a table with players will remove all players from that table. Use "Break Table" first if you want to move them.
          </div>
        </div>
      ),
    },
    reports: {
      title: 'Running Reports',
      content: (
        <div className="tutorial-content">
          <div className="tutorial-steps">
            <div className="step-item">
              <div className="step-number">1</div>
              <div className="step-text">
                <strong>Click "Reports":</strong> Located in the header at the top of the page.
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">2</div>
              <div className="step-text">
                <strong>Choose Report Type:</strong>
                <ul>
                  <li><strong>Shift Report:</strong> Select date/time range for door fees and refunds</li>
                  <li><strong>Club Day Report:</strong> Shows totals for the current active day</li>
                </ul>
              </div>
            </div>
            <div className="step-item">
              <div className="step-number">3</div>
              <div className="step-text">
                <strong>Generate & Print:</strong> Click "Generate Report" - it will automatically open the print dialog optimized for 80mm receipt printers.
              </div>
            </div>
          </div>
          <div className="tutorial-tip">
            💡 <strong>Tip:</strong> Reports are formatted for thermal receipt printers. Use your browser's print dialog to print or save as PDF.
          </div>
        </div>
      ),
    },
    complete: {
      title: 'You\'re All Set!',
      content: (
        <div className="tutorial-content">
          <div className="tutorial-complete">
            <p className="complete-message">
              You now know how to perform the most critical tasks in the system!
            </p>
            <div className="complete-summary">
              <h4>Quick Reference:</h4>
              <ul>
                <li><strong>Move Players:</strong> Drag & drop or use Actions menu</li>
                <li><strong>Break Table:</strong> Header → Break Table button</li>
                <li><strong>Remove Table:</strong> Table card → Remove Table button</li>
                <li><strong>Reports:</strong> Header → Reports button</li>
              </ul>
            </div>
            <p className="complete-footer">
              Need help? All features have tooltips and helpful error messages.
            </p>
          </div>
        </div>
      ),
    },
  };

  const stepOrder: TutorialStep[] = ['intro', 'moving-players', 'breaking-tables', 'removing-tables', 'reports', 'complete'];
  const currentIndex = stepOrder.indexOf(currentStep);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === stepOrder.length - 1;

  const handleNext = () => {
    if (!isLast) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    } else {
      handleClose();
    }
  };

  const handlePrevious = () => {
    if (!isFirst) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    }
  };

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('quickstart_tutorial_disabled', 'true');
    }
    onClose();
  };

  const handleSkip = () => {
    handleClose();
  };

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-modal">
        <div className="tutorial-header">
          <h2>{steps[currentStep].title}</h2>
          <button className="tutorial-close" onClick={handleClose} aria-label="Close tutorial">
            ×
          </button>
        </div>

        <div className="tutorial-body">
          {steps[currentStep].content}
        </div>

        <div className="tutorial-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${((currentIndex + 1) / stepOrder.length) * 100}%` }}
            />
          </div>
          <div className="progress-text">
            Step {currentIndex + 1} of {stepOrder.length}
          </div>
        </div>

        <div className="tutorial-footer">
          <label className="tutorial-checkbox">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don't show this tutorial again</span>
          </label>
          <div className="tutorial-actions">
            <button className="tutorial-button tutorial-button-secondary" onClick={handleSkip}>
              Skip Tutorial
            </button>
            {!isFirst && (
              <button className="tutorial-button tutorial-button-secondary" onClick={handlePrevious}>
                Previous
              </button>
            )}
            <button className="tutorial-button tutorial-button-primary" onClick={handleNext}>
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
