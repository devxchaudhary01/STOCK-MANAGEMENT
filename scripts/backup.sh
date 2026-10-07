#!/usr/bin/env bash
# Daily backup of MongoDB + invoice files. Usage: MONGODB_URI=... STORAGE_DIR=... BACKUP_DIR=/backups ./scripts/backup.sh
set -euo pipefail
: "${MONGODB_URI:?set MONGODB_URI}"; STORAGE_DIR="${STORAGE_DIR:-./server/storage}"; BACKUP_DIR="${BACKUP_DIR:-./backups}"; KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p "$BACKUP_DIR"
mongodump --uri="$MONGODB_URI" --gzip --archive="$BACKUP_DIR/db-$STAMP.archive.gz"
[ -d "$STORAGE_DIR" ] && tar -czf "$BACKUP_DIR/files-$STAMP.tar.gz" -C "$STORAGE_DIR" .
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "Backup done: $BACKUP_DIR (db-$STAMP, files-$STAMP)"
