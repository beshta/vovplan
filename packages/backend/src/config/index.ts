import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

function required(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  database: {
    url: required('DATABASE_URL', 'postgresql://vovplan:vovplan@localhost:5432/vovplan?schema=public'),
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev-secret-change-in-production-please-use-32+chars'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY ?? 'vovplan',
    secretKey: process.env.S3_SECRET_KEY ?? 'vovplan123',
    bucket: process.env.S3_BUCKET ?? 'vovplan-assets',
    region: process.env.S3_REGION ?? 'us-east-1',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  },
} as const;

export type Config = typeof config;
