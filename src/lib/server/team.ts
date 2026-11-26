import 'server-only';
import { randomUUID } from 'node:crypto';
import type { OrgRole, TeamMember } from '@/lib/types';
import { getObject, putObject } from './storage';

const ROSTER_PATH = '_org/team-roster.json';

const DEFAULT_TEAM: TeamMember[] = [
  {
    id: 'default-hr',
    name: 'Noy Chanthavong (HR)',
    email: 'hr@signflow.org',
    role: 'hr',
    department: 'Human Resources',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'default-director',
    name: 'Somsack Phomvihane (Director)',
    email: 'director@signflow.org',
    role: 'director',
    department: 'Operations & Legal',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'default-boss',
    name: 'Khamla Vongsa (Boss / CEO)',
    email: 'boss@signflow.org',
    role: 'boss',
    department: 'Executive Office',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export async function loadTeamRoster(): Promise<TeamMember[]> {
  try {
    const bytes = await getObject(ROSTER_PATH);
    if (!bytes) return DEFAULT_TEAM;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as TeamMember[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEAM;
  } catch {
    return DEFAULT_TEAM;
  }
}

export async function saveTeamRoster(members: TeamMember[]): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(members, null, 2));
  await putObject(ROSTER_PATH, bytes, 'application/json');
}

export async function upsertTeamMember(input: {
  name: string;
  email: string;
  role: OrgRole;
  department: string;
}): Promise<TeamMember[]> {
  const roster = await loadTeamRoster();
  const cleanEmail = input.email.toLowerCase().trim();
  const existingIdx = roster.findIndex((m) => m.email.toLowerCase() === cleanEmail);
  const member: TeamMember = {
    id: existingIdx >= 0 ? roster[existingIdx].id : randomUUID(),
    name: input.name.trim(),
    email: cleanEmail,
    role: input.role,
    department: input.department.trim() || 'General',
    createdAt: existingIdx >= 0 ? roster[existingIdx].createdAt : new Date().toISOString(),
  };
  if (existingIdx >= 0) roster[existingIdx] = member;
  else roster.push(member);
  await saveTeamRoster(roster);
  return roster;
}

export async function removeTeamMember(id: string): Promise<TeamMember[]> {
  const roster = await loadTeamRoster();
  const next = roster.filter((m) => m.id !== id);
  await saveTeamRoster(next);
  return next;
}
