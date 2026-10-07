import mongoose from 'mongoose';
import { config } from './config';
import { createApp } from './app';

(async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { autoIndex: true });
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`SSCT Stock API listening on :${config.port} (${config.isProd ? 'production' : 'development'})`));
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0))); process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
