import { db } from '../db';
import { sqlite } from '../db';
import {
  studentXp,
  badges,
  studentBadges,
  dailyGoals,
  attempts,
  wordMasteryRecords,
  students,
} from '../db/schema';
import { eq, and, desc, sql, sum } from 'drizzle-orm';

export function awardXp(studentId: number, amount: number, reason: string) {
  return db
    .insert(studentXp)
    .values({
      studentId,
      amount,
      reason,
      earnedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export function getStudentXp(studentId: number): number {
  const result = db
    .select({ total: sum(studentXp.amount) })
    .from(studentXp)
    .where(eq(studentXp.studentId, studentId))
    .get();
  return Number(result?.total ?? 0);
}

export function getStudentBadges(studentId: number) {
  return db
    .select({
      id: studentBadges.id,
      earnedAt: studentBadges.earnedAt,
      badgeId: badges.id,
      code: badges.code,
      name: badges.name,
      description: badges.description,
      icon: badges.icon,
      xpReward: badges.xpReward,
    })
    .from(studentBadges)
    .innerJoin(badges, eq(studentBadges.badgeId, badges.id))
    .where(eq(studentBadges.studentId, studentId))
    .all();
}

export function checkAndAwardBadges(studentId: number) {
  const now = new Date().toISOString();
  const earned = getStudentBadges(studentId);
  const earnedCodes = new Set(earned.map((b) => b.code));
  const newlyAwarded: Array<{ code: string; name: string; xpReward: number }> = [];

  function tryAward(code: string) {
    if (earnedCodes.has(code)) return;
    const badge = db.select().from(badges).where(eq(badges.code, code)).get();
    if (!badge) return;
    db.insert(studentBadges)
      .values({ studentId, badgeId: badge.id, earnedAt: now })
      .run();
    if (badge.xpReward > 0) {
      awardXp(studentId, badge.xpReward, 'badge_earned');
    }
    newlyAwarded.push({ code: badge.code, name: badge.name, xpReward: badge.xpReward });
  }

  // Count distinct words practiced (via attempts -> practice_tasks -> vocabulary_item_id)
  const distinctWordsRow = sqlite
    .prepare(
      `SELECT COUNT(DISTINCT pt.vocabulary_item_id) as cnt
       FROM attempts a
       JOIN practice_tasks pt ON a.practice_task_id = pt.id
       WHERE a.student_id = ? AND pt.vocabulary_item_id IS NOT NULL`
    )
    .get(studentId) as { cnt: number } | undefined;
  const distinctWords = distinctWordsRow?.cnt ?? 0;

  if (distinctWords >= 1) tryAward('first_word');
  if (distinctWords >= 10) tryAward('10_words');
  if (distinctWords >= 50) tryAward('50_words');
  if (distinctWords >= 100) tryAward('100_words');

  // Check streak
  const streak = getStreak(studentId);
  if (streak >= 3) tryAward('streak_3');
  if (streak >= 7) tryAward('streak_7');
  if (streak >= 30) tryAward('streak_30');

  // Check perfect score
  const perfectRow = sqlite
    .prepare(
      `SELECT COUNT(*) as cnt FROM attempts WHERE student_id = ? AND composite_score >= 0.95`
    )
    .get(studentId) as { cnt: number } | undefined;
  if ((perfectRow?.cnt ?? 0) > 0) tryAward('perfect_score');

  // Count mastered words
  const masteredRow = sqlite
    .prepare(
      `SELECT COUNT(*) as cnt FROM word_mastery_records WHERE student_id = ? AND mastery_status = 'Mastered'`
    )
    .get(studentId) as { cnt: number } | undefined;
  if ((masteredRow?.cnt ?? 0) >= 10) tryAward('mastered_10');

  return newlyAwarded;
}

export function getStreak(studentId: number): number {
  // Get distinct dates with at least 1 attempt, ordered descending
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT DATE(timestamp) as d FROM attempts WHERE student_id = ? ORDER BY d DESC`
    )
    .all(studentId) as Array<{ d: string }>;

  if (rows.length === 0) return 0;

  const today = new Date().toISOString().split('T')[0];
  let streak = 0;
  let expectedDate = new Date(today);

  // If the most recent practice day is not today or yesterday, streak is 0
  const lastPractice = rows[0].d;
  const diffFromToday = Math.floor(
    (new Date(today).getTime() - new Date(lastPractice).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffFromToday > 1) return 0;

  // Start from the most recent day
  expectedDate = new Date(lastPractice);

  for (const row of rows) {
    const rowDate = new Date(row.d);
    const diff = Math.floor(
      (expectedDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diff === 0) {
      streak++;
      expectedDate.setDate(expectedDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function getDailyGoal(studentId: number) {
  const today = new Date().toISOString().split('T')[0];
  const existing = db
    .select()
    .from(dailyGoals)
    .where(and(eq(dailyGoals.studentId, studentId), eq(dailyGoals.date, today)))
    .get();

  if (existing) return existing;

  // Create today's goal
  return db
    .insert(dailyGoals)
    .values({
      studentId,
      date: today,
      targetWords: 10,
      completedWords: 0,
      completed: false,
    })
    .returning()
    .get();
}

export function updateDailyGoal(studentId: number, wordsCompleted: number) {
  const today = new Date().toISOString().split('T')[0];
  const goal = getDailyGoal(studentId);

  const newCompleted = goal.completedWords + wordsCompleted;
  const isCompleted = newCompleted >= goal.targetWords;

  db.update(dailyGoals)
    .set({
      completedWords: newCompleted,
      completed: isCompleted,
    })
    .where(and(eq(dailyGoals.studentId, studentId), eq(dailyGoals.date, today)))
    .run();

  return { ...goal, completedWords: newCompleted, completed: isCompleted };
}

export function getLeaderboard(className?: string) {
  let query: string;
  const params: unknown[] = [];

  if (className) {
    query = `
      SELECT s.id, s.full_name as fullName, s.class, COALESCE(SUM(xp.amount), 0) as totalXp
      FROM students s
      LEFT JOIN student_xp xp ON s.id = xp.student_id
      WHERE s.class = ? AND s.is_active = 1
      GROUP BY s.id
      ORDER BY totalXp DESC
      LIMIT 50
    `;
    params.push(className);
  } else {
    query = `
      SELECT s.id, s.full_name as fullName, s.class, COALESCE(SUM(xp.amount), 0) as totalXp
      FROM students s
      LEFT JOIN student_xp xp ON s.id = xp.student_id
      WHERE s.is_active = 1
      GROUP BY s.id
      ORDER BY totalXp DESC
      LIMIT 50
    `;
  }

  return sqlite.prepare(query).all(...params) as Array<{
    id: number;
    fullName: string;
    class: string | null;
    totalXp: number;
  }>;
}
