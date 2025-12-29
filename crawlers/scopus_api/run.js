#!/usr/bin/env node

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

async function run() {
    // Helper untuk ambil semua author dari endpoint detail jika perlu
    async function fetchAllAuthorsFromDetail(eid, apiKey) {
      if (!eid) return null;
      const url = `https://api.elsevier.com/content/abstract/scopus_id/${eid}?field=author,affiliation`;
      const headers = {
        'X-ELS-APIKey': apiKey,
        'Accept': 'application/json'
      };
      try {
        const detail = await fetchJson(url, headers);
        // Cek struktur detail dan ambil semua author
        // Biasanya: detail['abstracts-retrieval-response'].authors.author (array)
        const arr = detail && detail['abstracts-retrieval-response'] && detail['abstracts-retrieval-response'].authors && detail['abstracts-retrieval-response'].authors.author;
        if (Array.isArray(arr)) {
          return arr.map(a => ({
            name: a['authname'] || a['ce:indexed-name'] || a['author-name'] || a['name'] || '',
            authid: a['authid'] || '',
            hIndex: 0,
            fullName: (a['preferred-name'] && a['preferred-name']['ce:indexed-name']) || a['authname'] || a['author-name'] || a['name'] || ''
          })).filter(x => x.name);
        }
      } catch (err) {
        // Jika gagal, abaikan saja
      }
      return null;
    }
  // ===== REQUIRE (CJS + ESM SAFE) =====
  let __require;
  try {
    __require = require;
  } catch {
    const mod = await import('module');
    __require = mod.createRequire(import.meta.url);
  }

  try { __require('dotenv').config(); } catch {}

  const https = __require('https');
  const { URL } = __require('url');
  const fs = __require('fs');
  const { MongoClient } = __require('mongodb');

  // ===== ARGUMENT PARSER =====
  function parseArgs() {
    const args = process.argv.slice(2);
    const res = {};
    args.forEach(a => {
      if (a.startsWith('--')) {
        const [k, v] = a.slice(2).split('=');
        res[k] = v === undefined ? true : v;
      }
    });
    return res;
  }

  const opts = parseArgs();
  const apiKey = opts.apiKey || process.env.SCOPUS_API_KEY;
  if (!apiKey) {
    throw new Error('SCOPUS API KEY tidak ditemukan');
  }

  // ===== HTTP FETCH =====
  function fetchJson(url, headers) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON')); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }


  // ===== MAIN LOGIC =====
  const results = [];
  console.error('DEBUG: mulai crawling Scopus');

  const affil = opts.affil || opts.affiliation || '';
  const startYear = parseInt(opts.startYear || '2019', 10);
  const endYear = parseInt(opts.endYear || startYear, 10);
  const count = parseInt(opts.count || '25', 10);
  const maxStart = opts.maxStart ? parseInt(opts.maxStart, 10) : null;
  const startFrom = opts.start ? parseInt(opts.start, 10) : 0;

  for (let y = startYear; y <= endYear; y++) {
    const query = `AFFIL(${affil})`;
    let start = startFrom;
    while (true) {
      if (maxStart !== null && start >= maxStart) break;
      const q = encodeURIComponent(query);
      const url = `https://api.elsevier.com/content/search/scopus?query=${q}&start=${start}&count=${count}`;
      const headers = {
        'X-ELS-APIKey': apiKey,
        'Accept': 'application/json'
      };
      let body;
      try {
        body = await fetchJson(url, headers);
        console.error(`DEBUG: fetched ${url}`);
      } catch (err) {
        console.error('API request failed:', err.message);
        break;
      }
      const entries = (body['search-results'] && body['search-results'].entry) || [];
      for (const e of entries) {
          // DEBUG: log struktur author untuk investigasi parsing
          const affiliationsCount = (() => {
            let affiliations = [];
            try {
              const aff = e.affiliation || e.affiliations || e['dc:publisher'] || null;
              if (aff) {
                if (Array.isArray(aff)) {
                  aff.forEach(a => {
                    if (!a) return;
                    if (typeof a === 'string') affiliations.push(a);
                    else if (a.affilname) affiliations.push(a.affilname);
                    else if (a['affiliation-name']) affiliations.push(a['affiliation-name']);
                  });
                } else if (typeof aff === 'object') {
                  if (aff.affilname) affiliations.push(aff.affilname);
                  else if (aff['affiliation-name']) affiliations.push(aff['affiliation-name']);
                }
              }
            } catch {}
            return affiliations.length;
          })();
          const authorCount = (e.author && Array.isArray(e.author)) ? e.author.length : 0;
          if (affiliationsCount > 1 && authorCount <= 1) {
            console.error('DEBUG: ENTRY FULL JSON (affiliations > 1, author <= 1):', JSON.stringify(e, null, 2));
          }
        // Parse affiliations
        let affiliations = [];
        try {
          const aff = e.affiliation || e.affiliations || e['dc:publisher'] || null;
          if (aff) {
            if (Array.isArray(aff)) {
              aff.forEach(a => {
                if (!a) return;
                if (typeof a === 'string') affiliations.push(a);
                else if (a.affilname) affiliations.push(a.affilname);
                else if (a['affiliation-name']) affiliations.push(a['affiliation-name']);
              });
            } else if (typeof aff === 'object') {
              if (aff.affilname) affiliations.push(aff.affilname);
              else if (aff['affiliation-name']) affiliations.push(aff['affiliation-name']);
            }
          }
        } catch {}

        // Parse authorsDetailed (multi-struktur, fallback, dan enrichment dari endpoint detail jika perlu)
        let authorsDetailed = [];
        // 1. Scopus structured author array
        if (e.author && Array.isArray(e.author)) {
          e.author.forEach(a => {
            const name = a['authname'] || a['ce:indexed-name'] || a['author-name'] || '';
            const authid = a['authid'] || '';
            authorsDetailed.push({
              name: (name || '').trim(),
              authid: (authid || '').trim(),
              hIndex: 0,
              fullName: (name || '').trim()
            });
          });
        }
        // 2. Nested authors structure: e.authors.author
        if (e.authors && e.authors.author) {
          const arr = Array.isArray(e.authors.author) ? e.authors.author : [e.authors.author];
          arr.forEach(a => {
            const name = a['authname'] || a['ce:indexed-name'] || a['author-name'] || a['name'] || '';
            const authid = a['authid'] || '';
            if (!authorsDetailed.some(x => x.name === name)) {
              authorsDetailed.push({
                name: (name || '').trim(),
                authid: (authid || '').trim(),
                hIndex: 0,
                fullName: (name || '').trim()
              });
            }
          });
        }
        // 3. Fallback: dc:creator (semicolon/comma/and separated string)
        if (e['dc:creator']) {
          const raw = (e['dc:creator'] || '');
          const parts = raw.split(/;|,|\sand\s/).map(s => s.trim()).filter(Boolean);
          parts.forEach(n => {
            if (!authorsDetailed.some(x => x.name === n)) {
              authorsDetailed.push({ name: n, authid: '', hIndex: 0, fullName: n });
            }
          });
        }

        // 4. Jika hanya dapat 1 author, tapi affiliations > 1, coba fetch detail author
        if (authorsDetailed.length <= 1 && affiliations.length > 1 && e.eid) {
          const urlDetail = `https://api.elsevier.com/content/abstract/scopus_id/${e.eid}?field=author,affiliation`;
          const headersDetail = {
            'X-ELS-APIKey': apiKey,
            'Accept': 'application/json'
          };
          let detail = null;
          try {
            detail = await fetchJson(urlDetail, headersDetail);
          } catch (err) {
            console.error('DEBUG: Gagal fetch detail author:', err && err.message ? err.message : err);
          }
          // Log detail jika authors hanya satu
          if (detail) {
            console.error('DEBUG: DETAIL RESPONSE:', JSON.stringify(detail, null, 2));
          }
          // Coba ambil authors dari detail
          const arr = detail && detail['abstracts-retrieval-response'] && detail['abstracts-retrieval-response'].authors && detail['abstracts-retrieval-response'].authors.author;
          if (Array.isArray(arr) && arr.length > 1) {
            authorsDetailed = arr.map(a => ({
              name: a['authname'] || a['ce:indexed-name'] || a['author-name'] || a['name'] || '',
              authid: a['authid'] || '',
              hIndex: 0,
              fullName: (a['preferred-name'] && a['preferred-name']['ce:indexed-name']) || a['authname'] || a['author-name'] || a['name'] || ''
            })).filter(x => x.name);
          }
        }

        // Parse authors (from authorsDetailed)
        const authors = authorsDetailed.map(a => a.fullName || a.name);

        // Parse citation
        const citation = parseInt(
          e['citedby-count'] || e['citedby_count'] || (e['coredata'] && e['coredata']['citedby-count']) || '0', 10
        ) || 0;

        // Parse coverDate & publicationYear
        const coverDate = e['prism:coverDate'] || e['coverDate'] || '';
        let publicationYear = '';
        const yearMatch = (coverDate || '').match(/(19|20)\d{2}/);
        if (yearMatch) publicationYear = yearMatch[0];

        // Build item
        const item = {
          _id: e['eid'] || e['prism:doi'] || undefined,
          eid: e['eid'] || '',
          affiliations,
          authors,
          authorsDetailed,
          citation,
          coverDate,
          doi: e['prism:doi'] || '',
          publicationName: e['prism:publicationName'] || '',
          publicationYear,
          title: e['dc:title'] || '',
        };
        results.push(item);
      }
      const total = parseInt((body['search-results'] && body['search-results']['opensearch:totalResults']) || '0', 10);
      start += count;
      if (start >= total || entries.length === 0) break;
    }
  }

  console.error('DEBUG: crawling selesai, total:', results.length);

  // ===== DEDUPLICATION: EID > DOI > TITLE =====
  const seenEid = new Set();
  const seenDoi = new Set();
  const seenTitle = new Set();
  const deduped = [];
  for (const item of results) {
    if (item.eid && seenEid.has(item.eid)) continue;
    if (item.doi && seenDoi.has(item.doi)) continue;
    // Judul distandarisasi lowercase dan trim
    const normTitle = (item.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!item.eid && !item.doi && normTitle && seenTitle.has(normTitle)) continue;
    // Mark as seen
    if (item.eid) seenEid.add(item.eid);
    if (item.doi) seenDoi.add(item.doi);
    if (!item.eid && !item.doi && normTitle) seenTitle.add(normTitle);
    deduped.push(item);
  }
  console.error('DEBUG: setelah dedup, total:', deduped.length);

  // ===== SAVE TO MONGODB =====
  const mongoUri = opts.mongoUri || process.env.MONGO_URI;

  if (mongoUri) {
    if (deduped.length > 0) {
      const client = new MongoClient(mongoUri);
      await client.connect();
      const dbName = new URL(mongoUri).pathname.replace('/', '') || 'journal_crawling';
      const db = client.db(dbName);
      // Bulk upsert agar tidak error jika _id sudah ada
      const ops = deduped.map(doc => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: doc },
          upsert: true
        }
      }));
      if (ops.length > 0) {
        await db.collection('journal').bulkWrite(ops, { ordered: false });
      }
      await client.close();
      console.error('DEBUG: data tersimpan ke MongoDB (bulk upsert)');
    } else {
      console.error('DEBUG: Tidak ada data untuk disimpan ke MongoDB, proses simpan dilewati.');
    }
  }

  // ===== OUTPUT =====
  console.log(JSON.stringify(deduped, null, 2));
}

// ===== ENTRY POINT (HANYA SATU) =====
(async () => {
  await run();
})().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
