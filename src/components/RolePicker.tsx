'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_ROLES, roleLabel } from '@/lib/types';

const STORAGE_KEY = 'sf-custom-roles';

export function useCustomRoles(extraRoles: string[] = []) {
  const [custom, setCustom] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCustom(parsed.filter((x) => typeof x === 'string' && x.trim()));
      }
    } catch {
      // ignore
    }
  }, []);

  const addCustomRole = (rawName: string): string | null => {
    const clean = rawName.trim().slice(0, 32);
    if (!clean) return null;
    const lower = clean.toLowerCase();
    const existingBuiltin = DEFAULT_ROLES.find((r) => r.toLowerCase() === lower || roleLabel(r).toLowerCase() === lower);
    if (existingBuiltin) return existingBuiltin;

    const next = Array.from(new Set([...custom, clean]));
    setCustom(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    return clean;
  };

  const removeCustomRole = (target: string) => {
    const next = custom.filter((r) => r !== target);
    setCustom(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  // Merge built-in + custom + any role from existing team roster
  const allRoles = Array.from(
    new Set([
      ...DEFAULT_ROLES,
      ...custom,
      ...extraRoles.filter((r) => r && !DEFAULT_ROLES.includes(r.toLowerCase())),
    ]),
  );

  return { allRoles, customRoles: custom, addCustomRole, removeCustomRole };
}

interface RolePickerProps {
  value: string;
  onChange(role: string): void;
  extraRoles?: string[];
  allowDeleteCustom?: boolean;
}

export function RolePicker({ value, onChange, extraRoles = [], allowDeleteCustom = false }: RolePickerProps) {
  const { allRoles, customRoles, addCustomRole, removeCustomRole } = useCustomRoles(
    value ? [...extraRoles, value] : extraRoles,
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commitNewRole = () => {
    const created = addCustomRole(draft);
    if (created) {
      onChange(created);
      setDraft('');
      setAdding(false);
    }
  };

  return (
    <div className="stack-sm">
      <div className="seg full">
        {allRoles.map((r) => {
          const isActive = value.toLowerCase() === r.toLowerCase();
          const isCustom = customRoles.includes(r);
          return (
            <button
              key={r}
              type="button"
              className={isActive ? 'active' : ''}
              onClick={() => onChange(r)}
              title={isCustom && allowDeleteCustom ? 'Custom role' : roleLabel(r)}
            >
              {roleLabel(r)}
              {isCustom && allowDeleteCustom && (
                <span
                  role="button"
                  tabIndex={-1}
                  style={{ marginLeft: 5, opacity: 0.6 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustomRole(r);
                    if (isActive) onChange('director');
                  }}
                  title="Remove custom role"
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className={adding ? 'active' : ''}
          onClick={() => setAdding((v) => !v)}
          title="Add a custom role (e.g. Legal, IT Manager, Accounting)"
        >
          + Custom
        </button>
      </div>

      {adding && (
        <div className="copy-field">
          <input
            className="input"
            autoFocus
            maxLength={32}
            placeholder="Type custom role (e.g. Legal, Accounting, CEO)..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewRole();
              } else if (e.key === 'Escape') {
                setAdding(false);
              }
            }}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={commitNewRole}>
            Add Role
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
