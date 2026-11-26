import 'server-only';
import type { AuditEvent, DocumentRecord, OtpRecord } from '@/lib/types';
import { supabaseAdmin } from '../supabase';
import type { Repo } from './index';

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`[supabase] ${op} failed: ${error?.message ?? 'unknown error'}`);
}

export const supabaseRepo: Repo = {
  async createDocument(input) {
    const { data, error } = await supabaseAdmin().from('documents').insert(input).select('*').single();
    if (error || !data) fail('createDocument', error);
    return data as DocumentRecord;
  },

  async getDocumentByToken(token) {
    const { data, error } = await supabaseAdmin().from('documents').select('*').eq('sign_token', token).maybeSingle();
    if (error) fail('getDocumentByToken', error);
    return (data as DocumentRecord) ?? null;
  },

  async getDocumentByRef(refCode) {
    const { data, error } = await supabaseAdmin().from('documents').select('*').eq('ref_code', refCode).maybeSingle();
    if (error) fail('getDocumentByRef', error);
    return (data as DocumentRecord) ?? null;
  },

  async refCodeExists(refCode) {
    const { count, error } = await supabaseAdmin()
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('ref_code', refCode);
    if (error) fail('refCodeExists', error);
    return (count ?? 0) > 0;
  },

  async findDocumentByHash(sha256) {
    const db = supabaseAdmin();
    const final = await db.from('documents').select('*').eq('final_sha256', sha256).limit(1).maybeSingle();
    if (final.error) fail('findDocumentByHash', final.error);
    if (final.data) return { doc: final.data as DocumentRecord, match: 'final' };
    const stage1 = await db.from('documents').select('*').eq('stage1_sha256', sha256).limit(1).maybeSingle();
    if (stage1.error) fail('findDocumentByHash', stage1.error);
    if (stage1.data) return { doc: stage1.data as DocumentRecord, match: 'stage1' };
    return null;
  },

  async updateDocument(id, patch) {
    const { data, error } = await supabaseAdmin().from('documents').update(patch).eq('id', id).select('*').single();
    if (error || !data) fail('updateDocument', error);
    return data as DocumentRecord;
  },

  async deleteDocument(id) {
    const { error } = await supabaseAdmin().from('documents').delete().eq('id', id);
    if (error) fail('deleteDocument', error);
  },

  async addEvent(event) {
    const { data, error } = await supabaseAdmin()
      .from('audit_events')
      .insert({ ...event, metadata: event.metadata ?? {} })
      .select('*')
      .single();
    if (error || !data) fail('addEvent', error);
    return data as AuditEvent;
  },

  async listEvents(documentId) {
    const { data, error } = await supabaseAdmin()
      .from('audit_events')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    if (error) fail('listEvents', error);
    return (data ?? []) as AuditEvent[];
  },

  async createOtp(otp) {
    const { data, error } = await supabaseAdmin().from('otp_codes').insert(otp).select('*').single();
    if (error || !data) fail('createOtp', error);
    return data as OtpRecord;
  },

  async latestOtp(documentId, email) {
    const { data, error } = await supabaseAdmin()
      .from('otp_codes')
      .select('*')
      .eq('document_id', documentId)
      .eq('email', email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail('latestOtp', error);
    return (data as OtpRecord) ?? null;
  },

  async updateOtp(id, patch) {
    const { error } = await supabaseAdmin().from('otp_codes').update(patch).eq('id', id);
    if (error) fail('updateOtp', error);
  },

  async ping() {
    const { count, error } = await supabaseAdmin().from('documents').select('id', { count: 'exact', head: true });
    if (error) fail('ping', error);
    return { documents: count ?? 0 };
  },
};
