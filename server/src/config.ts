import 'dotenv/config';
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const need = (k: string, dev?: string) => { const v = env[k] ?? (isProd ? undefined : dev); if (v === undefined || v === '') throw new Error(`Missing required env var ${k}`); return v; };

const authRequired = env.AUTH_REQUIRED !== 'false';   // default ON: Admin and Sales panels need login. Set AUTH_REQUIRED=false only for single-user use
export const config = {
  authRequired,
  isProd, isTest: env.NODE_ENV === 'test',
  port: Number(env.PORT || 4000),
  mongoUri: need('MONGODB_URI', 'mongodb://127.0.0.1:27017/ssct_stock'),
  jwtSecret: authRequired ? need('JWT_SECRET', 'dev-only-secret-change-me-dev-only-secret') : (env.JWT_SECRET || 'unused-while-auth-is-disabled-0000000000'),
  jwtExpires: env.JWT_EXPIRES_IN || '12h',
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean),
  storageDir: env.STORAGE_DIR || './storage',
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 10),
  serveClient: env.SERVE_CLIENT === 'true',
  tz: env.APP_TZ || 'Asia/Kolkata',
  ocr: { provider: (env.OCR_PROVIDER || 'none') as 'anthropic' | 'mock' | 'none', apiKey: env.ANTHROPIC_API_KEY || '', model: env.OCR_MODEL || 'claude-sonnet-5-5' },
  admin: { username: env.ADMIN_USERNAME || 'admin', password: env.ADMIN_PASSWORD || '', name: env.ADMIN_NAME || 'Administrator' },
};
if (config.authRequired && config.isProd && config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
