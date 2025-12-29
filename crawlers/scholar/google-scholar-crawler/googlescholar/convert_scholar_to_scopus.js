// Script to convert Google Scholar output.json to Scopus-like format
// Usage: node convert_scholar_to_scopus.js output.json output_scopus.json

const fs = require('fs');

function parseAuthors(authorsStr) {
  if (!authorsStr) return [];
  // Remove trailing journal info if present
  let names = authorsStr.split('-')[0].split(',');
  return names.map(name => {
    name = name.trim();
    if (!name) return null;
    return {
      name,
      authId: null,
      hIndex: null,
      fullName: null
    };
  }).filter(Boolean);
}

function parseCitation(citationText) {
  if (!citationText) return 0;
  const match = citationText.match(/Cited by (\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseJournalYearSrc(journalYearSrc) {
  if (!journalYearSrc) return { publicationName: null, publicationYear: null };
  // Example: "M Musa, MN Ismail,   - JOIV: International Journal on Informatics …, 2021 - joiv.org"
  const parts = journalYearSrc.split('-');
  if (parts.length < 2) return { publicationName: null, publicationYear: null };
  // Find the part with the journal name and year
  let journalPart = parts[1].trim();
  let yearMatch = journalPart.match(/(\d{4})/);
  let publicationYear = yearMatch ? yearMatch[1] : null;
  // Remove year and trailing info from journal name
  let publicationName = journalPart.replace(/,?\s*\d{4}.*/, '').replace(/…/, '').trim();
  return { publicationName, publicationYear };
}

function convertEntry(entry) {
  const { publicationName, publicationYear } = parseJournalYearSrc(entry['journal-year-src']);
  return {
    title: entry.title || null,
    affiliation: null,
    authorDetailed: parseAuthors(entry.authors),
    citation: parseCitation(entry['citation-text']),
    coverDate: publicationYear,
    doi: null,
    eid: null,
    publicationName,
    publicationYear,
    url: entry.url || null
  };
}

function main() {
  const [,, inputFile, outputFile] = process.argv;
  if (!inputFile || !outputFile) {
    console.error('Usage: node convert_scholar_to_scopus.js input.json output.json');
    process.exit(1);
  }
  const raw = fs.readFileSync(inputFile, 'utf8');
  let data = JSON.parse(raw);
  if (!Array.isArray(data)) data = [data];
  const converted = data.map(convertEntry);
  fs.writeFileSync(outputFile, JSON.stringify(converted, null, 2), 'utf8');
  console.log('Conversion complete. Output written to', outputFile);
}

main();
