const baseUrl = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const response = await fetch(`${baseUrl}/api/dev/learning-quality`);
if (!response.ok) throw new Error(`Learning-quality route returned ${response.status}.`);
const report = await response.json();
if (report.total !== 76 || report.failed !== 0 || report.passed !== true) {
  const failures = Array.isArray(report.failures)
    ? report.failures.map((failure) => failure.name).join(', ')
    : 'unavailable';
  throw new Error(
    `Learning-quality gate failed: ${report.failed}/${report.total}; failures=${failures}`,
  );
}
console.log(`[learning-quality] ${report.total}/${report.total} checks passed.`);
