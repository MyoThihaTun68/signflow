import 'server-only';
import type { PDFDocument } from 'pdf-lib';
import { env } from './config';

export function isP12Configured(): boolean {
  return Boolean(env.p12Base64);
}

/**
 * Adds a PKCS#7 (adbe.pkcs7.detached) signature using the configured P12 certificate.
 * Must be the very last modification of the document. Returns null when not configured.
 */
export async function signWithP12(pdfDoc: PDFDocument, signerName: string): Promise<Uint8Array | null> {
  if (!isP12Configured()) return null;
  const [{ pdflibAddPlaceholder }, { P12Signer }, signpdfMod] = await Promise.all([
    import('@signpdf/placeholder-pdf-lib'),
    import('@signpdf/signer-p12'),
    import('@signpdf/signpdf'),
  ]);
  type SignPdfCtor = new () => { sign: (b: Buffer, s: unknown) => Promise<Buffer> };
  const mod = signpdfMod as unknown as { SignPdf?: SignPdfCtor; default?: { SignPdf?: SignPdfCtor } };
  const SignPdf = mod.SignPdf ?? mod.default?.SignPdf;
  if (!SignPdf) throw new Error('@signpdf/signpdf could not be loaded');
  const signpdf = new SignPdf();

  pdflibAddPlaceholder({
    pdfDoc,
    reason: env.signingReason,
    contactInfo: env.signingContact || 'SignFlow',
    name: signerName,
    location: env.signingLocation,
    signatureLength: 16384,
    appName: 'SignFlow',
  });
  const unsigned = await pdfDoc.save({ useObjectStreams: false });
  const signer = new P12Signer(Buffer.from(env.p12Base64, 'base64'), { passphrase: env.p12Passphrase });
  const signed = await signpdf.sign(Buffer.from(unsigned), signer);
  return new Uint8Array(signed);
}
