# SignFlow — Paper-to-Digital Scanner, OTP Co-Signing & SHA-256 PDF Verifier

Production-ready **Next.js 15 (App Router, TypeScript)** E-Signature and Paper-to-Digital web application designed for **Vercel + Supabase (PostgreSQL + Private Storage)**.

## Highlights
- **Section A — Scan & Prepare (`/`)**:
  - Camera capture (`getUserMedia` front/back flip), multi-image/PDF drag-and-drop, clipboard paste (`Ctrl+V`), and 1-click Sample Paper Contract generator.
  - **100% original image colors preserved** (no destructive B&W filters).
  - Interactive 4-corner & 4-edge crop box with rule-of-thirds guide, Auto-Trim Edges, `-90° / +90° / 180° / Flip H`, `-15°..+15°` fine tilt with alignment grid, `Hold: Original` comparison, and A4 / US Letter / Original page presets.
  - Client-side compression (max 1400 px longest side, 0.82 JPEG) + optional Signer 1 digital mark.
- **Section B — Review & Co-Sign (`/sign/[token]` & `/sign`)**:
  - Automatic `viewed` audit event logging (IP, User-Agent, UTC timestamp).
  - 6-digit Email OTP verification gate (`otp_codes` SHA-256 hashed, 10-minute expiry).
  - Interactive `pdfjs-dist` canvas preview with zoom (`−`, `100%`, `+`), page pills, Draw / Type / Photo-Scan (auto background removal to transparent PNG) signature creator, and click-or-drag stamp placement directly over the original page background (no extra pages added).
- **Section C — Verify PDF (`/verify`)**:
  - Zero-knowledge client-side SHA-256 verification against `stage1_sha256` and `final_sha256` with full chronological Audit Event Timeline and JSON export.
- **Keep-Alive Cron (`/api/cron/keep-alive`)**:
  - Scheduled in `vercel.json` (`0 0 */3 * *`) to prevent Supabase free-tier 7-day inactivity pausing.

## Quick Start
```bash
cp .env.example .env.local
npm install
npm run dev
```
