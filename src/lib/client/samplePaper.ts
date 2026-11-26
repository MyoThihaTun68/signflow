'use client';

import { createCanvas } from './image';

/**
 * Generates a realistic, full-color photographed paper document on a warm wooden desk
 * so the user can test Auto-Trim, 4-Corner Crop, Tilt Straightening, Signer 1 Mark,
 * and Co-Signing with 1 click — even without a camera or sample file handy.
 */
export async function generateSamplePaperBlob(): Promise<{ blob: Blob; name: string }> {
  const c = createCanvas(1200, 1600);
  const ctx = c.getContext('2d')!;

  // Warm desk background so Auto-Trim Edges visibly snaps to the paper boundary
  const desk = ctx.createLinearGradient(0, 0, c.width, c.height);
  desk.addColorStop(0, '#2e3846');
  desk.addColorStop(1, '#1e2530');
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, c.width, c.height);

  // Paper sheet with subtle drop shadow
  const px = 95;
  const py = 110;
  const pw = 1010;
  const ph = 1380;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#fffdf9';
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  // Blue top accent bar & company seal (demonstrates 100% original color preservation)
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(px, py, pw, 14);

  ctx.fillStyle = '#eff6ff';
  ctx.beginPath();
  ctx.arc(px + pw - 110, py + 95, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#1d4ed8';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SIGNFLOW', px + pw - 110, py + 93);
  ctx.font = '11px sans-serif';
  ctx.fillText('VERIFIED', px + pw - 110, py + 109);

  // Heading
  ctx.textAlign = 'left';
  ctx.fillStyle = '#2563eb';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('SIGNFLOW CLOUD · PAPER-TO-DIGITAL DEMO', px + 70, py + 76);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('Master Service & NDA Agreement', px + 70, py + 122);

  ctx.fillStyle = '#64748b';
  ctx.font = '17px sans-serif';
  ctx.fillText(`Effective Date: ${new Date().toISOString().slice(0, 10)}   ·   Ref: DEMO-CONTRACT`, px + 70, py + 156);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px + 70, py + 182);
  ctx.lineTo(px + pw - 70, py + 182);
  ctx.stroke();

  // Clauses
  const sections: [string, string[]][] = [
    [
      '1. Scope of Engagement',
      [
        'Provider agrees to deliver cloud infrastructure, digital workflow automation, and cryptographic',
        'document sealing services in accordance with the specifications agreed between both parties.',
      ],
    ],
    [
      '2. Data Integrity & Cryptographic Fingerprinting',
      [
        'Every document processed under this agreement is hashed with SHA-256 at Stage 1 (original scan)',
        'and upon final completion. Any single-byte modification invalidates the registered fingerprint.',
      ],
    ],
    [
      '3. Confidentiality & Security',
      [
        'Both parties shall maintain strict confidentiality regarding proprietary technical data, access',
        'tokens, and customer records. All storage buckets remain private with Row-Level Security enabled.',
      ],
    ],
    [
      '4. Term & Acceptance',
      [
        'This agreement takes effect upon OTP-verified electronic co-signature by Signer 2 and remains in',
        'full force for twelve (12) months unless terminated earlier in writing by either party.',
      ],
    ],
  ];

  let y = py + 236;
  for (const [heading, lines] of sections) {
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 21px sans-serif';
    ctx.fillText(heading, px + 70, y);
    y += 32;
    ctx.fillStyle = '#334155';
    ctx.font = '17.5px sans-serif';
    for (const line of lines) {
      ctx.fillText(line, px + 70, y);
      y += 28;
    }
    y += 24;
  }

  // Highlighted callout box in warm amber/green to showcase color retention
  ctx.fillStyle = '#f0fdf4';
  ctx.strokeStyle = '#86efac';
  ctx.lineWidth = 2;
  ctx.fillRect(px + 70, y, pw - 140, 88);
  ctx.strokeRect(px + 70, y, pw - 140, 88);
  ctx.fillStyle = '#15803d';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Tip: Click "Auto Trim Edges" in the toolbar above to snap the crop box to this sheet!', px + 92, y + 36);
  ctx.fillStyle = '#166534';
  ctx.font = '15.5px sans-serif';
  ctx.fillText('Original paper & ink colors are 100% preserved — zero black-and-white thresholding.', px + 92, y + 64);

  // Signature blocks at bottom of page
  const sigY = py + ph - 190;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px + 70, sigY);
  ctx.lineTo(px + 420, sigY);
  ctx.moveTo(px + pw - 420, sigY);
  ctx.lineTo(px + pw - 70, sigY);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('SIGNER 1 (Sender / Prepared By)', px + 70, sigY + 26);
  ctx.fillText('SIGNER 2 (Co-Signer / Place Stamp Above)', px + pw - 420, sigY + 26);

  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Sample generation failed'))), 'image/jpeg', 0.92),
  );
  return { blob, name: 'Sample-Service-Agreement.jpg' };
}
