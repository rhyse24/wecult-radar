@echo off
rem WeCult Radar — local Reddit leg (residential IP; GitHub runners are
rem blocked by Reddit). Scheduled every 30 min via Windows Task Scheduler.
cd /d "%~dp0"
node --env-file=.env src/index.js --job=scan --sources=reddit >> radar-local.log 2>&1
