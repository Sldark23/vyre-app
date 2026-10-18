#!/bin/bash
# Backup diário do banco do Vyre (PostgreSQL 16, porta 5433)
set -e
PASS=$(grep VYRE_DB_PASSWORD /root/vyre-app/.env.db | cut -d= -f2)
STAMP=$(date +%Y-%m-%d_%H%M)
DIR=/root/vyre-backups
mkdir -p "$DIR"
PGPASSWORD="$PASS" pg_dump -h 127.0.0.1 -p 5433 -U vyre -d vyre --clean --if-exists | gzip > "$DIR/vyre_$STAMP.sql.gz"
# mantém só os 7 backups mais recentes
ls -t "$DIR"/vyre_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "[$(date)] backup ok: $DIR/vyre_$STAMP.sql.gz ($(du -h "$DIR/vyre_$STAMP.sql.gz" | cut -f1))"
