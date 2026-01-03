/**
 * Automation scheduler for crawling jobs.
 *
 * Edit the constants below to change the publication year range and other
 * defaults. This module exposes `startScheduler()` which registers a cron
 * job that will call `startScopusApi()` from the crawler service.
 */
require('dotenv').config();
const cron = require('node-cron');
const { startScopusApi, startScholarSelenium, startSintaScrap, startSintaDosen } = require('../modules/crawler/crawler.service');
const { exportToSpreadsheet } = require('../app/exportToSpreadsheet');
const { getDb } = require('../db');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- Manual automation settings (edit these values) -----------------------
// Affiliation to search for
const AFFIL = 'Telkom University';
// Publication years (inclusive)
const START_YEAR = 2024;
const END_YEAR = 2024;
// How many results per automated run (pass as --count to runner)
const COUNT = 20;
const countScholar = 100; // for scholar
// Cron expression: default is daily at 22:59 (minute hour ...)
// You can override with environment variable SCHED_CRON (standard cron format)
const DEFAULT_CRON = '51 01 * * *';
let CRON_EXPR = process.env.SCHED_CRON || DEFAULT_CRON;
// If user accidentally provided swapped minute/hour like '22 59 * * *', try to auto-correct
try {
  const parts = CRON_EXPR.trim().split(/\s+/);
  if (parts.length >= 2) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    if (!isNaN(p0) && !isNaN(p1) && p0 > 59 && p1 <= 23) {
      const rest = parts.slice(2).join(' ');
      CRON_EXPR = `${p1} ${p0}${rest ? ' ' + rest : ''}`;
      console.warn(`Scheduler: detected swapped cron fields, auto-corrected to '${CRON_EXPR}'`);
    }
  }
} catch (e) {
  // ignore
}
// Timezone support (optional). Default to Asia/Jakarta for local Indonesian time.
const CRON_TZ = process.env.SCHED_TZ || 'Asia/Jakarta';
// Mongo URI to pass to the spawned runner (optional override)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/journal_crawling';
// Optional: batasi start dan mulai dari start tertentu
const MAX_START = 1100;
const START_INDEX = 1000;
// SINTA scraping page range
const SINTA_PAGE_START = 39;
const SINTA_PAGE_END = 40;
// -------------------------------------------------------------------------

function startScheduler() {
  console.log(`Scheduler: registering cron '${CRON_EXPR}' tz='${CRON_TZ}' (affil=${AFFIL} years=${START_YEAR}-${END_YEAR})`);
  cron.schedule(CRON_EXPR, async () => {
    console.log('Scheduler: cron triggered');
    try {
      // Attempt to use DB to determine which years need crawling to avoid duplicates
      let db = null;
      try { db = getDb(); } catch (e) { db = null; }
      // Build a single skip-file from existing data (EIDs/DOIs/titles) so the
      // crawler can deduplicate results based on actual data rather than
      // skipping entire years when some records exist. This prevents
      // redundancy while still allowing missing items within a year to be
      // crawled.
      const yearsToCrawl = [];
      for (let y = START_YEAR; y <= END_YEAR; y++) yearsToCrawl.push(y);

      let skipFilePath = null;
      if (db) {
        try {
          const existing = await db.collection('journal').find({ affiliations: { $in: [ new RegExp(AFFIL, 'i') ] } }).project({ eid: 1, doi: 1, title: 1 }).toArray();
          const eids = existing.map(r => r.eid).filter(Boolean);
          const dois = existing.map(r => r.doi).filter(Boolean);
          const titles = existing.map(r => (r.title || '').toLowerCase());
          const payload = { eids, dois, titles };
          const tmp = os.tmpdir();
          const fname = `journal_skip_${Date.now()}.json`;
          skipFilePath = path.join(tmp, fname);
          fs.writeFileSync(skipFilePath, JSON.stringify(payload), 'utf8');
          console.log(`Scheduler: wrote skip file ${skipFilePath} (eids=${eids.length}, dois=${dois.length}, titles=${titles.length})`);
        } catch (e) {
          console.warn('Scheduler: failed to build skip file, proceeding without it:', e && e.message ? e.message : e);
          skipFilePath = null;
        }
      }

      if (yearsToCrawl.length === 0) {
        console.log('Scheduler: nothing to crawl (no years configured)');
        return;
      }

      // Spawn one job per year for Scopus and one for Scholar (parallel automation)
      for (const y of yearsToCrawl) {
        try {
          console.log(`Scheduler: starting Scopus job for year ${y}`);
          startScopusApi({
            affil: AFFIL,
            startYear: y,
            endYear: y,
            count: COUNT,
            mongoUri: MONGO_URI,
            skipFile: skipFilePath,
            maxStart: MAX_START,
            start: START_INDEX
          });
        } catch (e) {
          console.error('Scheduler: failed to start scopus job for year', y, e && e.message ? e.message : e);
        }
      }
      // Scholar job: run once for all affiliation (no year in query)
      try {
        console.log(`Scheduler: starting Scholar job for affiliation only: ${AFFIL}`);
        startScholarSelenium({
          query: AFFIL,
          count: countScholar,
          mongoUri: MONGO_URI,
          output: `output_scholar_all.json`
        });
      } catch (e) {
        console.error('Scheduler: failed to start scholar job for affiliation', e && e.message ? e.message : e);
      }
      // Sinta job: run once for the configured page range
      try {
        console.log(`Scheduler: starting Sinta job for pages ${SINTA_PAGE_START}-${SINTA_PAGE_END}`);
        startSintaScrap({
          pageStart: SINTA_PAGE_START,
          pageEnd: SINTA_PAGE_END
        });
      } catch (e) {
        console.error('Scheduler: failed to start sinta job', e && e.message ? e.message : e);
      }
      // Sinta Dosen job: run once for the configured page range
      try {
        console.log(`Scheduler: starting Sinta Dosen job for pages ${SINTA_PAGE_START}-${SINTA_PAGE_END}`);
        startSintaDosen({
          pageStart: SINTA_PAGE_START,
          pageEnd: SINTA_PAGE_END
        });
      } catch (e) {
        console.error('Scheduler: failed to start sinta dosen job', e && e.message ? e.message : e);
      }

      // Export to Google Sheets after all crawling jobs are started
      try {
        console.log('Scheduler: starting Google Sheets export job');
        const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
        if (spreadsheetId) {
          // Run export asynchronously to not block the scheduler
          setTimeout(async () => {
            try {
              const result = await exportToSpreadsheet(spreadsheetId);
              if (result.success) {
                console.log('Scheduler: Google Sheets export completed successfully');
              } else {
                console.error('Scheduler: Google Sheets export failed:', result.message);
              }
            } catch (e) {
              console.error('Scheduler: unexpected error during Google Sheets export:', e && e.message ? e.message : e);
            }
          }, 10); // Small delay to ensure crawling jobs have started
        } else {
          console.warn('Scheduler: GOOGLE_SPREADSHEET_ID not configured, skipping Google Sheets export');
        }
      } catch (e) {
        console.error('Scheduler: failed to start Google Sheets export job', e && e.message ? e.message : e);
      }
    } catch (e) {
      console.error('Scheduler: unexpected error during cron job:', e && e.message ? e.message : e);
    }
  }, { scheduled: true, timezone: CRON_TZ });
}

async function runOnceNow() {
  console.log('Scheduler: running a single immediate job');
  let db = null;
  try { db = getDb(); } catch (e) { db = null; }

  let skipFilePath = null;
  if (db) {
    try {
      const existing = await db.collection('journal').find({ affiliations: { $in: [ new RegExp(AFFIL, 'i') ] } }).project({ eid: 1, doi: 1, title: 1 }).toArray();
      const eids = existing.map(r => r.eid).filter(Boolean);
      const dois = existing.map(r => r.doi).filter(Boolean);
      const titles = existing.map(r => (r.title || '').toLowerCase());
      const payload = { eids, dois, titles };
      const tmp = os.tmpdir();
      const fname = `journal_skip_${Date.now()}.json`;
      skipFilePath = path.join(tmp, fname);
      fs.writeFileSync(skipFilePath, JSON.stringify(payload), 'utf8');
      console.log(`Scheduler: wrote skip file ${skipFilePath} (eids=${eids.length}, dois=${dois.length}, titles=${titles.length})`);
    } catch (e) {
      console.warn('Scheduler: failed to build skip file for runOnceNow, proceeding without it:', e && e.message ? e.message : e);
      skipFilePath = null;
    }
  }

  // Run both Scopus and Scholar jobs in parallel for immediate/manual run
  startScopusApi({
    affil: AFFIL,
    startYear: START_YEAR,
    endYear: END_YEAR,
    count: COUNT,
    mongoUri: MONGO_URI,
    skipFile: skipFilePath,
    maxStart: MAX_START,
    start: START_INDEX
  });
  // Scholar job: run once for all affiliation (no year in query)
  startScholarSelenium({
    query: AFFIL,
    count: COUNT,
    mongoUri: MONGO_URI,
    output: `output_scholar_all.json`
  });

  // Sinta job: run once for the configured page range
  try {
    console.log(`Scheduler: starting Sinta job for pages ${SINTA_PAGE_START}-${SINTA_PAGE_END}`);
    startSintaScrap({
      pageStart: SINTA_PAGE_START,
      pageEnd: SINTA_PAGE_END
    });
  } catch (e) {
    console.error('Scheduler: failed to start sinta job', e && e.message ? e.message : e);
  }
  // Sinta Dosen job: run once for the configured page range
  try {
    console.log(`Scheduler: starting Sinta Dosen job for pages ${SINTA_PAGE_START}-${SINTA_PAGE_END}`);
    startSintaDosen({
      pageStart: SINTA_PAGE_START,
      pageEnd: SINTA_PAGE_END
    });
  } catch (e) {
    console.error('Scheduler: failed to start sinta dosen job', e && e.message ? e.message : e);
  }

  // Export to Google Sheets after manual run
  try {
    console.log('Scheduler: starting Google Sheets export job for manual run');
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (spreadsheetId) {
      // Run export asynchronously to not block the scheduler
      setTimeout(async () => {
        try {
          const result = await exportToSpreadsheet(spreadsheetId);
          if (result.success) {
            console.log('Scheduler: Google Sheets export completed successfully');
          } else {
            console.error('Scheduler: Google Sheets export failed:', result.message);
          }
        } catch (e) {
          console.error('Scheduler: unexpected error during Google Sheets export:', e && e.message ? e.message : e);
        }
      }, 1000); // Small delay to ensure crawling jobs have started
    } else {
      console.warn('Scheduler: GOOGLE_SPREADSHEET_ID not configured, skipping Google Sheets export');
    }
  } catch (e) {
    console.error('Scheduler: failed to start Google Sheets export job for manual run', e && e.message ? e.message : e);
  }
}

module.exports = { startScheduler, runOnceNow };
