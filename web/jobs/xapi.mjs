const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
const token = process.env.XAPI_JOB_TOKEN;
if (!baseUrl || !token) throw new Error('APP_BASE_URL and XAPI_JOB_TOKEN are required.');
const response = await fetch(`${baseUrl}/api/jobs/xapi`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) throw new Error(`xAPI worker returned ${response.status}.`);
console.log(JSON.stringify(await response.json()));
