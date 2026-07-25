process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/test';
process.env.DATABASE_SSL_MODE = 'disable';
process.env.SETTINGS_ENCRYPTION_KEY ||= 'vitest-only-encryption-key-with-32-characters';
