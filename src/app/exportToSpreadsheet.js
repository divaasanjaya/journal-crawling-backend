const { getDb } = require('../db');
const { getSpreadsheet } = require('../config/googleSheet');

async function exportToSpreadsheet(spreadsheetId) {
  try {
    console.log('Starting export to Google Sheets...');

    // Get database connection
    const db = getDb();

    // Fetch dosen data
    console.log('Fetching dosen data...');
    const dosenData = await fetchDosenData(db);

    // Fetch journal data grouped by year
    console.log('Fetching journal data...');
    const journalDataByYear = await fetchJournalDataByYear(db);

    // Get spreadsheet document
    console.log('Connecting to Google Sheets...');
    const doc = await getSpreadsheet(spreadsheetId);

    // Clear existing sheets and create new ones
    await clearAndCreateSheets(doc, journalDataByYear);

    // Export dosen data to Sheet 1
    console.log('Exporting dosen data...');
    await exportDosenData(doc, dosenData);

    // Export journal data to subsequent sheets
    console.log('Exporting journal data...');
    await exportJournalData(doc, journalDataByYear);

    console.log('Export completed successfully!');
    return { success: true, message: 'Data exported to Google Sheets successfully' };

  } catch (error) {
    console.error('Error during export:', error);
    return { success: false, message: `Export failed: ${error.message}` };
  }
}

async function fetchDosenData(db) {
  const dosenCollection = db.collection('dosen');
  const dosen = await dosenCollection.find({}).toArray();

  return dosen.map(d => ({
    nama: d.nama || '',
    department: d.department || '',
    total_article: (d.article_gscholar || 0) + (d.article_scopus || 0) + (d.article_wos || 0),
    total_citation: (d.citation_gscholar || 0) + (d.citation_scopus || 0) + (d.citation_wos || 0),
    hindex_gscholar: d.hindex_gscholar || 0,
    hindex_scopus: d.hindex_scopus || 0,
    hindex_wos: d.hindex_wos || 0
  }));
}

async function fetchJournalDataByYear(db) {
  const journalCollection = db.collection('journal');
  const journals = await journalCollection.find({}).toArray();

  // Group journals by publication year
  const grouped = {};
  journals.forEach(journal => {
    const year = journal.publicationYear || 'Unknown';
    if (!grouped[year]) {
      grouped[year] = [];
    }
    grouped[year].push({
      title: journal.title || '',
      authors: Array.isArray(journal.authors) ? journal.authors.join(', ') : '',
      publicationName: journal.publicationName || '',
      doi: journal.doi || '',
      citation: journal.citation || 0
    });
  });

  // Sort years in descending order
  const sortedYears = Object.keys(grouped).sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return parseInt(b) - parseInt(a);
  });

  const result = {};
  sortedYears.forEach(year => {
    result[year] = grouped[year];
  });

  return result;
}

async function clearAndCreateSheets(doc, journalDataByYear) {
  const years = Object.keys(journalDataByYear);

  // First, ensure we have the Data Author sheet
  let authorSheet = doc.sheetsByTitle['Data Author'];
  if (!authorSheet) {
    // Try to find and rename the first sheet, or create a new one
    if (doc.sheetsByIndex.length > 0) {
      authorSheet = doc.sheetsByIndex[0];
      await authorSheet.updateProperties({ title: 'Data Author' });
    } else {
      authorSheet = await doc.addSheet({ title: 'Data Author' });
    }
  }
  await authorSheet.clear();

  // Delete all other existing sheets
  const sheetsToDelete = doc.sheetsByIndex.filter(sheet => sheet.title !== 'Data Author');
  for (const sheet of sheetsToDelete) {
    await sheet.delete();
  }

  // Create or reuse sheets for each year
  for (const year of years) {
    const sheetTitle = `${year}`;
    let sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      // Create new sheet if it doesn't exist
      sheet = await doc.addSheet({ title: sheetTitle });
    } else {
      // Clear existing sheet
      await sheet.clear();
    }
  }
}

async function exportDosenData(doc, dosenData) {
  const sheet = doc.sheetsByIndex[0];
  await sheet.setHeaderRow([
    'Nama',
    'Department',
    'Total Article',
    'Total Citation',
    'H-Index GS',
    'H-Index Scopus',
    'H-Index WOS'
  ]);

  const rows = dosenData.map(d => [
    d.nama,
    d.department,
    d.total_article,
    d.total_citation,
    d.hindex_gscholar,
    d.hindex_scopus,
    d.hindex_wos
  ]);

  await sheet.addRows(rows);
}

async function exportJournalData(doc, journalDataByYear) {
  const years = Object.keys(journalDataByYear);

  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const journals = journalDataByYear[year];
    const sheet = doc.sheetsByIndex[i + 1]; // +1 because index 0 is dosen data

    // Clear existing content before adding new data
    await sheet.clear();

    await sheet.setHeaderRow([
      'Title',
      'Authors',
      'Publication Name',
      'DOI',
      'Citation'
    ]);

    const rows = journals.map(j => [
      j.title,
      j.authors,
      j.publicationName,
      j.doi,
      j.citation
    ]);

    await sheet.addRows(rows);
  }
}

module.exports = { exportToSpreadsheet };
