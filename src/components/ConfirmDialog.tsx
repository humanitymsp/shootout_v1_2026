import { useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import './ConfirmDialog.css';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmDialogProps extends ConfirmDialogOptions {
  onClose: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'info',
  onConfirm,
  onCancel,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, []);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  return (
    <div className="confirm-dialog-overlay" onClick={handleCancel}>
      <div className={`confirm-dialog confirm-dialog-${type}`} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-header">
          <h3>{title}</h3>
        </div>
        <div className="confirm-dialog-body">
          <p>{message}</p>
        </div>
        <div className="confirm-dialog-footer">
          <button className="confirm-dialog-btn confirm-dialog-btn-cancel" onClick={handleCancel}>
            {cancelText}
          </button>
          <button className={`confirm-dialog-btn confirm-dialog-btn-confirm confirm-dialog-btn-${type}`} onClick={handleConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper function to show confirmation dialog
let confirmDialogContainer: HTMLDivElement | null = null;
let currentRoot: Root | null = null;
let currentResolve: ((value: boolean) => void) | null = null;

export function showConfirmDialog(options: Omit<ConfirmDialogOptions, 'onConfirm' | 'onCancel'>): Promise<boolean> {
  return new Promise((resolve) => {
    // Clean up any existing dialog
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    if (confirmDialogContainer && confirmDialogContainer.parentNode) {
      confirmDialogContainer.parentNode.removeChild(confirmDialogContainer);
    }

    confirmDialogContainer = document.createElement('div');
    confirmDialogContainer.id = 'confirm-dialog-root';
    document.body.appendChild(confirmDialogContainer);

    currentResolve = resolve;
    currentRoot = createRoot(confirmDialogContainer);
    
    const ConfirmDialogWrapper = () => {
      const handleConfirm = () => {
        if (currentResolve) {
          currentResolve(true);
          currentResolve = null;
        }
        if (currentRoot) {
          currentRoot.unmount();
          currentRoot = null;
        }
        if (confirmDialogContainer && confirmDialogContainer.parentNode) {
          confirmDialogContainer.parentNode.removeChild(confirmDialogContainer);
          confirmDialogContainer = null;
        }
      };

      const handleCancel = () => {
        if (currentResolve) {
          currentResolve(false);
          currentResolve = null;
        }
        if (currentRoot) {
          currentRoot.unmount();
          currentRoot = null;
        }
        if (confirmDialogContainer && confirmDialogContainer.parentNode) {
          confirmDialogContainer.parentNode.removeChild(confirmDialogContainer);
          confirmDialogContainer = null;
        }
      };

      return (
        <ConfirmDialog
          {...options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          onClose={handleCancel}
        />
      );
    };

    currentRoot.render(<ConfirmDialogWrapper />);
  });
}
