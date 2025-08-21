#!/usr/bin/env bash
set -e

DURATION=30
MODE="server"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration) DURATION="$2"; shift; shift ;;
    --mode) MODE="$2"; shift; shift ;;
    *) shift ;;
  esac
done

echo "Waiting ${DURATION}s to collect auto-pushed metrics..."
sleep ${DURATION}
set +e
HTTP_CODE=$(curl -s -o /tmp/metrics.json -w "%{http_code}" http://localhost:3000/api/metrics)
set -e
if [ "$HTTP_CODE" = "200" ]; then
  cp /tmp/metrics.json metrics.json
  echo "Saved metrics.json"
else
  echo "No metrics available (http $HTTP_CODE). Ensure receiver is open and running."
fi


