import React from 'react'

/**
 * Placeholder legal copy — replace with counsel-reviewed text before public launch.
 */
export default function LegalPage({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px 10px' }}>
        <button
          type="button"
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#7A92B0', fontSize: 20, cursor: 'pointer' }}
        >
          ←
        </button>
        <div className="page-title">Privacy & Terms</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '11px 18px 28px', fontSize: 13, color: '#7A92B0', lineHeight: 1.65 }}>
        <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, color: '#fff', marginBottom: 8 }}>Privacy policy</h3>
        <p>
          Bizzkit helps businesses showcase products and connect with others. This is placeholder text. Before you launch publicly,
          replace this section with a privacy policy that describes what data you collect (for example account, profile, messages,
          media, device, and analytics), how you use it, legal bases where required, retention, sharing, international transfers,
          security measures, and user rights including deletion requests.
        </p>
        <h3 style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, color: '#fff', marginTop: 18, marginBottom: 8 }}>Terms of use</h3>
        <p>
          This is placeholder text. Replace it with terms of service covering acceptable use, accounts, content ownership and
          licensing, messaging and calls, limitations of liability, dispute resolution, and termination.
        </p>
        <p style={{ marginTop: 14, fontSize: 12.5, color: '#3A5070' }}>
          Support: add your public contact email here before launch.
        </p>
      </div>
    </div>
  )
}
