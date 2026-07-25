/**
 * Stage configuration: admins set the default order/unlock-mode of practice
 * stages for all students, and can override per-student.
 *
 * Storage:
 *   - default sequence:   app_settings["stage_default_sequence"]   (JSON array)
 *   - default unlock:     app_settings["stage_default_unlock_mode"] ("all" | "sequential" | "free")
 *   - per-student config: app_settings["student_<id>_stage_config"] (JSON object)
 */

import { db } from '../db';
import { appSettings, students } from '../db/schema';
import { eq } from 'drizzle-orm';

export const ALL_STAGE_KEYS = [
  'listen',
  'repeat',
  'read-aloud',
  'sentence',
  'free-speak',
  'review',
] as const;
export type StageKey = (typeof ALL_STAGE_KEYS)[number];

export type UnlockMode = 'all' | 'sequential' | 'free';

export interface StageConfig {
  /** Ordered list of stage keys to show. Stages not in the list are hidden. */
  sequence: StageKey[];
  /** How the stages unlock for the student. */
  unlockMode: UnlockMode;
}

const DEFAULT_SEQUENCE: StageKey[] = ['listen', 'repeat', 'read-aloud', 'sentence', 'free-speak', 'review'];
// All stages open by default so learners (and admins previewing) can reach any
// stage. Admins can switch a class/student back to "sequential" in Stage settings.
const DEFAULT_UNLOCK_MODE: UnlockMode = 'all';

const SEQ_KEY = 'stage_default_sequence';
const MODE_KEY = 'stage_default_unlock_mode';
const studentKey = (id: number) => `student_${id}_stage_config`;

async function getSetting(key: string): Promise<string | null> {
  const row = ((await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1))[0]);
  return row?.value ?? null;
}

async function setSetting(key: string, value: string) {
  const existing = ((await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1))[0]);
  if (existing) {
    (await db.update(appSettings).set({ value }).where(eq(appSettings.key, key)));
  } else {
    (await db.insert(appSettings).values({ key, value }));
  }
}

async function deleteSetting(key: string) {
  (await db.delete(appSettings).where(eq(appSettings.key, key)));
}

/** Validate and normalize a sequence — drop unknown keys, dedupe. */
function normalizeSequence(input: unknown): StageKey[] {
  if (!Array.isArray(input)) return [...DEFAULT_SEQUENCE];
  const seen = new Set<string>();
  const out: StageKey[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    if (!ALL_STAGE_KEYS.includes(v as StageKey)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as StageKey);
  }
  return out.length > 0 ? out : [...DEFAULT_SEQUENCE];
}

function normalizeUnlockMode(input: unknown): UnlockMode {
  return input === 'all' || input === 'free' || input === 'sequential' ? input : DEFAULT_UNLOCK_MODE;
}

/** Get the global default config. */
export async function getDefaultStageConfig(): Promise<StageConfig> {
  let sequence = DEFAULT_SEQUENCE;
  let unlockMode = DEFAULT_UNLOCK_MODE;
  const seqRaw = await getSetting(SEQ_KEY);
  if (seqRaw) {
    try { sequence = normalizeSequence(JSON.parse(seqRaw)); } catch { /* keep default */ }
  }
  const modeRaw = await getSetting(MODE_KEY);
  if (modeRaw) unlockMode = normalizeUnlockMode(modeRaw);
  return { sequence, unlockMode };
}

export async function setDefaultStageConfig(cfg: Partial<StageConfig>) {
  if (cfg.sequence) {
    await setSetting(SEQ_KEY, JSON.stringify(normalizeSequence(cfg.sequence)));
  }
  if (cfg.unlockMode) {
    await setSetting(MODE_KEY, normalizeUnlockMode(cfg.unlockMode));
  }
}

/** Get a per-student override (or null if no override set). */
export async function getStudentStageOverride(studentId: number): Promise<StageConfig | null> {
  const raw = await getSetting(studentKey(studentId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      sequence: normalizeSequence(parsed.sequence),
      unlockMode: normalizeUnlockMode(parsed.unlockMode),
    };
  } catch {
    return null;
  }
}

export async function setStudentStageOverride(studentId: number, cfg: StageConfig) {
  await setSetting(studentKey(studentId), JSON.stringify({
    sequence: normalizeSequence(cfg.sequence),
    unlockMode: normalizeUnlockMode(cfg.unlockMode),
  }));
}

export async function clearStudentStageOverride(studentId: number) {
  await deleteSetting(studentKey(studentId));
}

/** Resolve the effective config for a student (override → default). */
export async function getEffectiveStageConfig(studentId: number | null | undefined): Promise<StageConfig> {
  if (studentId) {
    const override = await getStudentStageOverride(studentId);
    if (override) return override;
  }
  return await getDefaultStageConfig();
}

/** List students that have an override configured. */
export async function listStudentsWithOverrides(): Promise<{ studentId: number; fullName: string; uniqueNumber: string; config: StageConfig }[]> {
  const allStudents = (await db.select().from(students));
  const out: { studentId: number; fullName: string; uniqueNumber: string; config: StageConfig }[] = [];
  for (const s of allStudents) {
    const cfg = await getStudentStageOverride(s.id);
    if (cfg) {
      out.push({
        studentId: s.id,
        fullName: s.fullName,
        uniqueNumber: s.uniqueNumber,
        config: cfg,
      });
    }
  }
  return out;
}
