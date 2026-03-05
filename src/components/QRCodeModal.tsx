import { QRCodeSVG } from 'qrcode.react';
import './QRCodeModal.css';

interface QRCodeModalProps {
  onClose: () => void;
}

export default function QRCodeModal({ onClose }: QRCodeModalProps) {
  // Get the current URL and construct the public link
  const publicUrl = `${window.location.origin}/public`;
  
  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicUrl);
  };

  const handlePrint = () => {
    // Get the SVG from the hidden print layout
    const svgEl = document.querySelector('.qr-print-layout svg') as SVGElement | null;
    const svgContent = svgEl ? svgEl.outerHTML : '';

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Cash Game Waitlist QR Code</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    @page {
      margin: 0;
      size: letter portrait;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 100vh;
      padding: 4rem 3rem;
      gap: 2rem;
    }
    .header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }
    .logo-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .divider {
      width: 48px;
      height: 2px;
      background: #cbd5e1;
      margin: 0.25rem auto;
    }
    .title {
      font-size: 2.75rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
      line-height: 1.1;
    }
    .qr-box {
      padding: 1.75rem;
      border: 2px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .url {
      font-size: 0.8rem;
      color: #94a3b8;
      font-family: 'Courier New', monospace;
      letter-spacing: 0.04em;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-wrap">
      <svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" width="220" height="110" preserveAspectRatio="xMidYMid meet">
        <g>
          <rect x="50" y="20" width="80" height="110" rx="8" ry="8" fill="#9ca3af" opacity="0.9" transform="rotate(-15 90 75)"/>
          <rect x="52" y="22" width="76" height="106" rx="6" ry="6" fill="#d1d5db" opacity="0.6" transform="rotate(-15 90 75)"/>
        </g>
        <g>
          <rect x="270" y="20" width="80" height="110" rx="8" ry="8" fill="#9ca3af" opacity="0.9" transform="rotate(15 310 75)"/>
          <rect x="272" y="22" width="76" height="106" rx="6" ry="6" fill="#d1d5db" opacity="0.6" transform="rotate(15 310 75)"/>
        </g>
        <g>
          <rect x="150" y="10" width="100" height="130" rx="10" ry="10" fill="#1e3a8a" stroke="#fbbf24" stroke-width="2"/>
          <rect x="152" y="12" width="96" height="126" rx="8" ry="8" fill="#1e40af"/>
          <g transform="translate(200, 75)">
            <path d="M 0 -45 C 0 -45, -8 -30, -25 -10 C -35 2, -30 25, -15 25 C -5 25, 0 15, 0 15 C 0 15, 5 25, 15 25 C 30 25, 35 2, 25 -10 C 8 -30, 0 -45, 0 -45 Z" fill="#fbbf24"/>
            <path d="M -8 15 L -15 45 L 15 45 L 8 15 Z" fill="#fbbf24"/>
          </g>
        </g>
        <text x="200" y="160" text-anchor="middle" font-size="36" font-family="Georgia, serif" fill="#f5f5dc" font-weight="700" letter-spacing="2">FINAL TABLE</text>
        <text x="200" y="185" text-anchor="middle" font-size="20" font-family="Georgia, serif" fill="#f5f5dc" font-weight="600" letter-spacing="3">POKER CLUB</text>
      </svg>
    </div>
    <div class="divider"></div>
    <div class="title">Cash Game Waitlist</div>
  </div>
  <div class="qr-box">${svgContent}</div>
  <div class="url">${publicUrl}</div>
  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>`);
    printWindow.document.close();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content qr-code-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>QR Code for Mobile View</h2>
          <div className="qr-modal-header-actions">
            <button className="btn-print" onClick={handlePrint} title="Print QR code">
              🖨️ Print
            </button>
            <button className="close-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div className="modal-body">
          {/* Print layout - only visible when printing */}
          <div className="qr-print-layout">
            <div className="qr-print-header">
              <div className="qr-print-club-name">Final Table Poker Club</div>
              <div className="qr-print-title">Cash Game Waitlist</div>
            </div>
            <div className="qr-print-code">
              <QRCodeSVG
                value={publicUrl}
                size={320}
                level="H"
                includeMargin={true}
                fgColor="#000000"
                bgColor="#ffffff"
              />
            </div>
            <div className="qr-print-url">{publicUrl}</div>
          </div>

          {/* Screen layout - hidden when printing */}
          <div className="qr-code-container qr-screen-only">
            <div className="qr-code-wrapper">
              <QRCodeSVG
                value={publicUrl}
                size={256}
                level="H"
                includeMargin={true}
                fgColor="#f1f5f9"
                bgColor="#0f1629"
              />
            </div>
            <div className="qr-code-info">
              <p className="qr-code-description">
                Scan this QR code with your phone to access the mobile view
              </p>
              <div className="qr-code-url-container">
                <input
                  type="text"
                  readOnly
                  value={publicUrl}
                  className="qr-code-url-input"
                />
                <button
                  className="btn-copy-link"
                  onClick={handleCopyLink}
                  title="Copy link to clipboard"
                >
                  📋 Copy
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
