import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = 'C:\\Users\\malfa\\Desktop\\SpeakingApp-Overview';

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const pages = [
  { url: '/', name: '01-login', desc: 'Login Page' },
  { url: '/register', name: '02-register', desc: 'Register Page' },
];

// Pages that require login
const authPages = [
  { url: '/admin/students', name: '03-admin-students', desc: 'Admin - Students' },
  { url: '/admin/books', name: '04-admin-books', desc: 'Admin - Books' },
  { url: '/admin/cycles', name: '05-admin-cycles', desc: 'Admin - Cycles' },
  { url: '/admin/practice-sets', name: '06-admin-practice-sets', desc: 'Admin - Practice Sets' },
  { url: '/admin/live-session', name: '07-admin-live-sessions', desc: 'Admin - Live Sessions' },
  { url: '/admin/models', name: '08-admin-models', desc: 'Admin - Models Overview' },
  { url: '/admin/models/stt', name: '09-admin-stt', desc: 'Admin - STT Settings' },
  { url: '/admin/models/tts', name: '10-admin-tts', desc: 'Admin - TTS Settings' },
  { url: '/admin/models/ai', name: '11-admin-ai', desc: 'Admin - AI Settings' },
  { url: '/admin/status', name: '12-admin-status', desc: 'Admin - System Status' },
  { url: '/dashboard', name: '13-dashboard', desc: 'Dashboard' },
  { url: '/practice/hub', name: '14-practice-hub', desc: 'Practice Hub' },
  { url: '/practice', name: '15-practice', desc: 'Practice Page' },
  { url: '/practice/texts', name: '16-text-library', desc: 'Text Practice Library' },
  { url: '/practice/texts/lists', name: '17-word-lists', desc: 'Word Lists' },
  { url: '/practice/history', name: '18-practice-history', desc: 'Practice History' },
  { url: '/teacher', name: '19-teacher-dashboard', desc: 'Teacher Dashboard' },
  { url: '/teacher/student/1', name: '20-teacher-student-review', desc: 'Teacher Student Review' },
  { url: '/teacher/attempt/1', name: '21-teacher-attempt', desc: 'Teacher Attempt Detail' },
  { url: '/teacher/review', name: '22-teacher-review-queue', desc: 'Teacher Review Queue' },
  { url: '/reports', name: '23-reports', desc: 'Reports - Student List' },
  { url: '/reports/class', name: '24-reports-class', desc: 'Reports - Class' },
  { url: '/reports/audio', name: '25-reports-audio', desc: 'Reports - Audio Archive' },
  { url: '/reports/progress/1', name: '26-reports-progress', desc: 'Reports - Progress' },
  { url: '/change-password', name: '27-change-password', desc: 'Change Password' },
];

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  // Capture non-auth pages first
  for (const p of pages) {
    console.log(`Capturing: ${p.desc}`);
    await page.goto(`http://localhost:3000${p.url}`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${p.name}.png`), fullPage: false });
    console.log(`  Saved: ${p.name}.png`);
  }

  // Login as admin
  console.log('Logging in as admin...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));

  try {
    await page.type('input[name="username"]', 'admin');
    await page.type('input[name="password"]', 'admin');
    await page.click('button[type="submit"]');
    await new Promise(r => setTimeout(r, 3000));
    console.log('Logged in successfully');
  } catch (e) {
    console.error('Login failed:', e.message);
  }

  // Capture auth pages
  for (const p of authPages) {
    console.log(`Capturing: ${p.desc}`);
    try {
      await page.goto(`http://localhost:3000${p.url}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      await page.screenshot({ path: path.join(OUTPUT_DIR, `${p.name}.png`), fullPage: false });
      console.log(`  Saved: ${p.name}.png`);
    } catch (e) {
      console.log(`  FAILED: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone! ${pages.length + authPages.length} screenshots saved to ${OUTPUT_DIR}`);
}

run().catch(console.error);
