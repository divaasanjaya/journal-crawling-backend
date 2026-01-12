const { getDb } = require('../db');
const { getSpreadsheet } = require('../config/googleSheet');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function exportToSpreadsheet(spreadsheetId) {
  try {
    const db = getDb();

    const dosenData = await fetchDosenData(db);
    const journalDataByYear = await fetchJournalDataByYear(db);

    const doc = await getSpreadsheet(spreadsheetId);

    await rebuildSheets(doc, journalDataByYear);
    await sleep(2500);

    await exportDosenData(doc, dosenData);
    await sleep(2500);

    await exportJournalData(doc, journalDataByYear);

    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, message: err.message };
  }
}

/* =====================
   FETCH DATA
===================== */

async function fetchDosenData(db) {
  const data = await db.collection('dosen').find({}).toArray();
  return data.map(d => ({
    Nama: d.nama || '',
    Department: d.department || '',
    'Total Article':
      (d.article_gscholar || 0) +
      (d.article_scopus || 0) +
      (d.article_wos || 0),
    'Total Citation':
      (d.citation_gscholar || 0) +
      (d.citation_scopus || 0) +
      (d.citation_wos || 0),
    'H-Index GS': d.hindex_gscholar || 0,
    'H-Index Scopus': d.hindex_scopus || 0,
    'H-Index WOS': d.hindex_wos || 0,
    'Sinta Score Overall': d.sinta_score_overall || 0,
    'Sinta Score 3yr': d.sinta_score_3yr || 0
  }));
}

async function fetchJournalDataByYear(db) {
  const data = await db.collection('journal').find({}).toArray();
  const grouped = {};

  for (const j of data) {
    const year = j.publicationYear || 'Unknown';
    if (!grouped[year]) grouped[year] = [];
    grouped[year].push({
      Title: j.title || '',
      Authors: Array.isArray(j.authors) ? j.authors.join(', ') : '',
      'Publication Name': j.publicationName || '',
      DOI: j.doi || '',
      Citation: j.citation || 0
    });
  }

  return Object.keys(grouped)
    .sort((a, b) => b - a)
    .reduce((o, k) => (o[k] = grouped[k], o), {});
}

/* =====================
   SHEET REBUILD
===================== */

async function rebuildSheets(doc, journalDataByYear) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Ambil semua sheet
  let sheets = doc.sheetsByIndex;

  // Pastikan minimal ada 1 sheet
  let baseSheet = sheets[0];

  // Rename sheet pertama jadi Data Author
  await baseSheet.updateProperties({ title: 'Data Author' });
  await sleep(2500);

  // Clear isinya (AMAN karena akan pakai headerValues ulang)
  await baseSheet.clear();

  // Set header Data Author SEKALI
  await baseSheet.setHeaderRow([
    'Nama',
    'Department',
    'Total Article',
    'Total Citation',
    'H-Index GS',
    'H-Index Scopus',
    'H-Index WOS',
    'Sinta Score Overall',
    'Sinta Score 3yr'
  ]);

  await sleep(2500);

  // Hapus sheet lain (selain Data Author)
  for (const sheet of sheets.slice(1)) {
    await sheet.delete();
    await sleep(2500);
  }

  // Buat sheet per tahun (langsung dengan header)
  for (const year of Object.keys(journalDataByYear)) {
    await doc.addSheet({
      title: year,
      headerValues: [
        'Title',
        'Authors',
        'Publication Name',
        'DOI',
        'Citation'
      ]
    });
    await sleep(2500);
  }
}

/* =====================
   EXPORT
===================== */

async function exportDosenData(doc, data) {
  const sheet = doc.sheetsByTitle['Data Author'];
  if (data.length) await sheet.addRows(data);
}

async function exportJournalData(doc, journalDataByYear) {
  for (const year of Object.keys(journalDataByYear)) {
    const sheet = doc.sheetsByTitle[year];
    const rows = journalDataByYear[year];
    if (rows.length) {
      await sheet.addRows(rows);
      await sleep(2500);
    }
  }
}

module.exports = { exportToSpreadsheet };
