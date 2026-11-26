import 'server-only';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { OrgRole, TeamMember } from '@/lib/types';
import { hmacHex, safeEqualHex } from './crypto';
import { getCookie } from './http';
import { getObject, putObject } from './storage';

const ROSTER_PATH = '_org/team-roster.json';

export interface StoredTeamMember extends TeamMember {
  passwordHash?: string;
  passwordSalt?: string;
}

const DEFAULT_TEAM: StoredTeamMember[] = [
  {
    id: 'default-hr',
    name: 'Noy Chanthavong (HR)',
    email: 'hr@signflow.org',
    role: 'hr',
    department: 'Human Resources',
    status: 'invited',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'default-director',
    name: 'Somsack Phomvihane (Director)',
    email: 'director@signflow.org',
    role: 'director',
    department: 'Operations & Legal',
    status: 'invited',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'default-boss',
    name: 'Khamla Vongsa (Boss / CEO)',
    email: 'boss@signflow.org',
    role: 'boss',
    department: 'Executive Office',
    status: 'invited',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export function toPublicMember(m: StoredTeamMember): TeamMember {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    department: m.department,
    status: m.passwordHash ? 'active' : m.status || 'invited',
    savedSignature: m.savedSignature ?? null,
    createdAt: m.createdAt,
    lastLoginAt: m.lastLoginAt ?? null,
  };
}

export async function loadStoredRoster(): Promise<StoredTeamMember[]> {
  try {
    const bytes = await getObject(ROSTER_PATH);
    if (!bytes) return DEFAULT_TEAM;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StoredTeamMember[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEAM;
  } catch {
    return DEFAULT_TEAM;
  }
}

export async function loadTeamRoster(): Promise<TeamMember[]> {
  const list = await loadStoredRoster();
  return list.map(toPublicMember);
}

export async function saveStoredRoster(members: StoredTeamMember[]): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(members, null, 2));
  await putObject(ROSTER_PATH, bytes, 'application/json');
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || randomBytes(16).toString('hex');
  const h = scryptSync(password, s, 64).toString('hex');
  return { hash: h, salt: s };
}

export function verifyPassword(password: string, salt?: string, expectedHash?: string): boolean {
  if (!salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  return safeEqualHex(hash, expectedHash);
}

export async function registerOrActivateMember(input: {
  name: string;
  email: string;
  password: string;
  role: OrgRole;
  department: string;
  allowOverwritePassword?: boolean;
}): Promise<{ member: TeamMember; roster: TeamMember[] }> {
  const roster = await loadStoredRoster();
  const cleanEmail = input.email.toLowerCase().trim();
  const idx = roster.findIndex((m) => m.email.toLowerCase() === cleanEmail);

  if (idx >= 0 && roster[idx].passwordHash && !input.allowOverwritePassword) {
    throw new Error('ACCOUNT_EXISTS');
  }

  const { hash, salt } = hashPassword(input.password);
  const now = new Date().toISOString();

  const updated: StoredTeamMember = {
    id: idx >= 0 ? roster[idx].id : randomUUID(),
    name: input.name.trim() || (idx >= 0 ? roster[idx].name : cleanEmail.split('@')[0]),
    email: cleanEmail,
    role: input.role || (idx >= 0 ? roster[idx].role : 'hr'),
    department: input.department.trim() || (idx >= 0 ? roster[idx].department : 'General'),
    status: 'active',
    createdAt: idx >= 0 ? roster[idx].createdAt : now,
    lastLoginAt: now,
    passwordHash: hash,
    passwordSalt: salt,
  };

  if (idx >= 0) roster[idx] = updated;
  else roster.push(updated);
  await saveStoredRoster(roster);

  return {
    member: toPublicMember(updated),
    roster: roster.map(toPublicMember),
  };
}

export async function authenticateMember(email: string, password: string): Promise<TeamMember> {
  const roster = await loadStoredRoster();
  const cleanEmail = email.toLowerCase().trim();
  const member = roster.find((m) => m.email.toLowerCase() === cleanEmail);
  if (!member) throw new Error('NOT_FOUND');
  if (!member.passwordHash) throw new Error('INVITED_NEEDS_SETUP');
  if (!verifyPassword(password, member.passwordSalt, member.passwordHash)) {
    throw new Error('INVALID_PASSWORD');
  }
  member.lastLoginAt = new Date().toISOString();
  member.status = 'active';
  await saveStoredRoster(roster);
  return toPublicMember(member);
}

export async function upsertTeamMember(input: {
  name: string;
  email: string;
  role: OrgRole;
  department: string;
}): Promise<TeamMember[]> {
  const roster = await loadStoredRoster();
  const cleanEmail = input.email.toLowerCase().trim();
  const existingIdx = roster.findIndex((m) => m.email.toLowerCase() === cleanEmail);
  const prev = existingIdx >= 0 ? roster[existingIdx] : null;
  const member: StoredTeamMember = {
    id: prev ? prev.id : randomUUID(),
    name: input.name.trim(),
    email: cleanEmail,
    role: input.role,
    department: input.department.trim() || 'General',
    status: prev?.passwordHash ? 'active' : 'invited',
    createdAt: prev ? prev.createdAt : new Date().toISOString(),
    lastLoginAt: prev?.lastLoginAt ?? null,
    passwordHash: prev?.passwordHash,
    passwordSalt: prev?.passwordSalt,
  };
  if (existingIdx >= 0) roster[existingIdx] = member;
  else roster.push(member);
  await saveStoredRoster(roster);
  return roster.map(toPublicMember);
}

export async function removeTeamMember(id: string): Promise<TeamMember[]> {
  const roster = await loadStoredRoster();
  const next = roster.filter((m) => m.id !== id);
  await saveStoredRoster(next);
  return next.map(toPublicMember);
}

export async function saveMemberSignature(email: string, signaturePng: string | null): Promise<TeamMember | null> {
  const roster = await loadStoredRoster();
  const cleanEmail = email.toLowerCase().trim();
  const idx = roster.findIndex((m) => m.email.toLowerCase() === cleanEmail);
  if (idx < 0) return null;
  roster[idx].savedSignature = signaturePng;
  await saveStoredRoster(roster);
  return toPublicMember(roster[idx]);
}

/* ── Signed Auth Session Cookie & Email Invite Token ── */

export const USER_COOKIE_NAME = 'sf_user_session';
export const USER_SESSION_TTL = 14 * 24 * 3600; // 14 days

export function createAuthCookieValue(member: TeamMember): string {
  const exp = Math.floor(Date.now() / 1000) + USER_SESSION_TTL;
  const payload = Buffer.from(
    JSON.stringify({
      id: member.id,
      email: member.email.toLowerCase(),
      name: member.name,
      role: member.role,
      department: member.department,
      exp,
    }),
  ).toString('base64url');
  const sig = hmacHex(`auth:${payload}`);
  return `${payload}.${sig}`;
}

export function readAuthSession(req: Request): TeamMember | null {
  const raw = getCookie(req, USER_COOKIE_NAME);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqualHex(sig, hmacHex(`auth:${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      id: string;
      email: string;
      name: string;
      role: OrgRole;
      department: string;
      exp: number;
    };
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
      department: data.department,
      status: 'active',
      createdAt: '',
    };
  } catch {
    return null;
  }
}

export interface InvitePayload {
  email: string;
  name: string;
  role: OrgRole;
  department: string;
  exp: number;
}

export function createInviteToken(input: Omit<InvitePayload, 'exp'>): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
  const payload = Buffer.from(JSON.stringify({ ...input, email: input.email.toLowerCase(), exp })).toString('base64url');
  const sig = hmacHex(`invite:${payload}`);
  return `${payload}.${sig}`;
}

export function verifyInviteToken(token: string): InvitePayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqualHex(sig, hmacHex(`invite:${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as InvitePayload;
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
