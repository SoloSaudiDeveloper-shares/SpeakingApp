import { db, pool } from '../db';
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

export async function awardXp(studentId: number, amount: number, reason: string) {
  return ((await db
    .insert(studentXp)
    .values({
      studentId,
      amount,
      reason,
      earnedAt: new Date().toISOString(),
    })
    .returning())[0]);
}

export async function getStudentXp(studentId: number): Promise<number> {
  const result = ((await db
    .select({ total: sum(studentXp.amount) })
    .from(studentXp)
    .where(eq(studentXp.studentId, studentId)).limit(1))[0]);
  return Number(result?.total ?? 0);
}

export async function getStudentBadges(studentId: number) {
  return (await db
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
    .where(eq(studentBadges.studentId, studentId)));
}

export async function checkAndAwardBadges(studentId: number) {
  const now = new Date().toISOString();
  const earned = await getStudentBadges(studentId);
  const earnedCodes = new Set(earned.map((b) => b.code));
  const newlyAwarded: Array<{ code: string; name: string; xpReward: number }> = [];

  async function tryAward(code: string) {
    if (earnedCodes.has(code)) return;
    const badge = ((await db.select().from(badges).where(eq(badges.code, code)).limit(1))[0]);
    if (!badge) return;
    (await db.insert(studentBadges)
      .values({ studentId, badgeId: badge.id, earnedAt: now }));
    if (badge.xpReward > 0) {
      await awardXp(studentId, badge.xpReward, 'badge_earned');
    }
    newlyAwarded.push({ code: badge.code, name: badge.name, xpReward: badge.xpReward });
  }

  // Count distinct words practiced (via attempts -> practice_tasks -> vocabulary_item_id)
  const distinctWordsResult = await pool.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT pt.vocabulary_item_id) as cnt
       FROM attempts a
       JOIN practice_tasks pt ON a.practice_task_id = pt.id
       WHERE a.student_id = $1 AND pt.vocabulary_item_id IS NOT NULL`,
      [studentId],
    );
  const distinctWordsRow = distinctWordsResult.rows[0];
  const distinctWords = Number(distinctWordsRow?.cnt ?? 0);

  if (distinctWords >= 1) await tryAward('first_word');
  if (distinctWords >= 10) await tryAward('10_words');
  if (distinctWords >= 50) await tryAward('50_words');
  if (distinctWords >= 100) await tryAward('100_words');

  // Check streak
  const streak = await getStreak(studentId);
  if (streak >= 3) await tryAward('streak_3');
  if (streak >= 7) await tryAward('streak_7');
  if (streak >= 30) await tryAward('streak_30');

  // Check perfect score
  const perfectResult = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int as cnt FROM attempts WHERE student_id = $1 AND composite_score >= 0.95`,
    [studentId],
  );
  if ((perfectResult.rows[0]?.cnt ?? 0) > 0) await tryAward('perfect_score');

  // Count mastered words
  const masteredResult = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int as cnt FROM word_mastery_records WHERE student_id = $1 AND mastery_status = 'Mastered'`,
    [studentId],
  );
  if ((masteredResult.rows[0]?.cnt ?? 0) >= 10) await tryAward('mastered_10');

  return newlyAwarded;
}

export async function getStreak(studentId: number): Promise<number> {
  // Get distinct dates with at least 1 attempt, ordered descending
  const { rows } = await pool.query<{ d: string }>(
    `SELECT DISTINCT timestamp::date::text as d FROM attempts WHERE student_id = $1 ORDER BY d DESC`,
    [studentId],
  );

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

export async function getDailyGoal(studentId: number) {
  const today = new Date().toISOString().split('T')[0];
  const existing = ((await db
    .select()
    .from(dailyGoals)
    .where(and(eq(dailyGoals.studentId, studentId), eq(dailyGoals.date, today))).limit(1))[0]);

  if (existing) return existing;

  // Create today's goal
  return ((await db
    .insert(dailyGoals)
    .values({
      studentId,
      date: today,
      targetWords: 10,
      completedWords: 0,
      completed: false,
    })
    .returning())[0]);
}

export async function updateDailyGoal(studentId: number, wordsCompleted: number) {
  const today = new Date().toISOString().split('T')[0];
  const goal = await getDailyGoal(studentId);

  const newCompleted = goal.completedWords + wordsCompleted;
  const isCompleted = newCompleted >= goal.targetWords;

  (await db.update(dailyGoals)
    .set({
      completedWords: newCompleted,
      completed: isCompleted,
    })
    .where(and(eq(dailyGoals.studentId, studentId), eq(dailyGoals.date, today))));

  return { ...goal, completedWords: newCompleted, completed: isCompleted };
}

export async function getLeaderboard(className?: string) {
  let query: string;
  const params: unknown[] = [];

  if (className) {
    query = `
      SELECT s.id, s.full_name as "fullName", s.class, COALESCE(SUM(xp.amount), 0) as "totalXp"
      FROM students s
      LEFT JOIN student_xp xp ON s.id = xp.student_id
      WHERE s.class = $1 AND s.is_active = true
      GROUP BY s.id
      ORDER BY totalXp DESC
      LIMIT 50
    `;
    params.push(className);
  } else {
    query = `
      SELECT s.id, s.full_name as "fullName", s.class, COALESCE(SUM(xp.amount), 0) as "totalXp"
      FROM students s
      LEFT JOIN student_xp xp ON s.id = xp.student_id
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY totalXp DESC
      LIMIT 50
    `;
  }

  const result = await pool.query<{
    id: number;
    fullName: string;
    class: string | null;
    totalXp: number;
  }>(query, params);
  return result.rows.map((row) => ({ ...row, totalXp: Number(row.totalXp) }));
}
