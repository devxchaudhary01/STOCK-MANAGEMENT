# Deployment, backup and restore

## Option A: simplest — one VPS or one Render/Railway service (Express serves the React build)
1. MongoDB Atlas (free M0 is enough to start): create cluster → Database Access user → Network Access (allow your server IP) → copy the connection string.
2. On the server: `git clone`, then
   ```bash
   npm run install:all && npm run build
   cp server/.env.example server/.env   # set below values
   npm run seed && npm start
   ```
   Required `.env`: `NODE_ENV=production`, `MONGODB_URI=<atlas uri>`, `JWT_SECRET=<48 random bytes hex>`, `ADMIN_PASSWORD=<strong>`, `SERVE_CLIENT=true`, `CORS_ORIGINS=https://stock.yourcompany.com`, `STORAGE_DIR=/var/data/ssct`, optional OCR keys.
3. Run under a process manager (`pm2 start "npm start" --name ssct`) behind nginx/Caddy with HTTPS. Proxy everything to `localhost:4000`; set `client_max_body_size 12m`.
4. **Files:** `STORAGE_DIR` must be a persistent disk (Render: attach a Disk and mount it there; Railway: Volume). Without it uploaded invoices vanish on redeploy. Storage lives behind `server/src/lib/storage.ts`; swap it for S3/R2 later without touching routes.

## Option B: split — Vercel (frontend) + Render/Railway (backend)
* **Backend** (Render Web Service, root `server`): build `npm install && npm run build`, start `npm start`, env as above but `SERVE_CLIENT=false` and `CORS_ORIGINS=https://<your-vercel-domain>`. Add a Disk for `STORAGE_DIR`. Run `npm run seed` once (Render shell).
* **Frontend** (Vercel, root `client`): framework Vite, build `npm run build`, output `dist`, env `VITE_API_URL=https://<backend>/api`. Add a rewrite of all paths to `/index.html` (SPA routing).
* Verify: `GET https://<backend>/api/health` returns `{ok:true,db:true}`.

## Production checklist
* After upgrading an existing database run `npm run seed` once: it adds new indexes and builds the fast-search words for old items.
* `JWT_SECRET` ≥ 32 chars (the server refuses to start otherwise). Change the seeded admin password.
* HTTPS only. CORS limited to your frontend origin. Login is rate-limited (10 per 15 min per IP).
* Atlas: restrict network access, enable backups (M10+) or use the script below.
* Indexes are created at startup and by `npm run seed`.
* Run the test-suite against a **real MongoDB** before first production use.

## Backup
**Database** (daily, cron): `scripts/backup.sh` (uses `mongodump`; install MongoDB Database Tools). It also archives the invoice folder and deletes backups older than 30 days.
```
0 2 * * *  MONGODB_URI="mongodb+srv://..." STORAGE_DIR=/var/data/ssct BACKUP_DIR=/backups /opt/ssct/scripts/backup.sh >> /var/log/ssct-backup.log 2>&1
```
Copy `/backups` off the machine (rsync / rclone to Google Drive or S3). Atlas M10+ also has built-in continuous backups.
**Invoices/files**: included above (`files-*.tar.gz`).

## Restore
```bash
# 1. stop the app
mongorestore --uri="$MONGODB_URI" --gzip --archive=db-20261005-020000.archive.gz --drop
mkdir -p $STORAGE_DIR && tar -xzf files-20261005-020000.tar.gz -C $STORAGE_DIR
# 2. start the app, then Settings > Data checks > Run check (stock vs ledger must show no differences)
```
Test a restore into a scratch database once, before you need it.
