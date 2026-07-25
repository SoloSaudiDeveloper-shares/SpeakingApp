# Explicit demo seed

Demo accounts are never created automatically and have no built-in passwords.

To create the local pilot data, set:

- `DEMO_DATA_ENABLED=true`
- `DEMO_ADMIN_PASSWORD`
- `DEMO_TEACHER_PASSWORD`
- `DEMO_STUDENT_PASSWORD`

Each password must contain at least 12 characters. Then run `npm run db:seed` once.
The command creates `demo-admin`, `demo-teacher`, and `demo-learner`, plus a complete
coffee-shop pathway from listen/repeat through controlled and open scenarios.

Without `DEMO_DATA_ENABLED=true`, `npm run db:seed` creates only a bootstrap administrator,
requires `BOOTSTRAP_ADMIN_PASSWORD`, and forces an immediate password change.
