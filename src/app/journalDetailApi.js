const { getDb } = require('../db');
const { ObjectId } = require('mongodb');

function normalizeName(name) {
  return name.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function getLastNameAndInitials(name) {
  const parts = name.split(/\s+/);
  if (parts.length === 0) return { lastName: '', initials: '' };

  let lastName, initials;
  if (parts.length === 2 && parts[1].includes('.')) {
    // Format: Lastname Initials (e.g., "Wardani D.S.")
    lastName = parts[0];
    initials = parts[1].replace(/\./g, '');
  } else {
    // Format: First Middle Last (e.g., "Diva Sanjaya Wardani")
    lastName = parts[parts.length - 1];
    initials = parts.slice(0, -1).map(p => p.charAt(0)).join('');
  }

  return { lastName: lastName.toUpperCase(), initials: initials.toUpperCase() };
}

async function findDosenId(authorName, dosenCollection) {
  if (!authorName || typeof authorName !== 'string') {
    console.log('Author name invalid:', authorName);
    return null;
  }
  const normalizedAuthor = normalizeName(authorName);
  console.log('Normalized author:', normalizedAuthor);
  const allDosen = await dosenCollection.find({}).toArray();
  console.log('All dosen count:', allDosen.length);

  // Exact match
  for (const d of allDosen) {
    const dosenName = d.name || d.nama;
    if (dosenName && normalizeName(dosenName) === normalizedAuthor) {
      console.log('Exact match found for', authorName, 'with', dosenName);
      return d._id.toString();
    }
  }

  // Partial match
  const authorParsed = getLastNameAndInitials(authorName);
  console.log('Author parsed:', authorParsed);
  for (const d of allDosen) {
    const dosenName = d.name || d.nama;
    if (dosenName) {
      const dosenParsed = getLastNameAndInitials(dosenName);
      console.log('Comparing with dosen:', dosenName, 'parsed:', dosenParsed);
      if (dosenParsed.lastName === authorParsed.lastName && dosenParsed.initials === authorParsed.initials) {
        console.log('Partial match found for', authorName, 'with', dosenName);
        return d._id.toString();
      }
    }
  }

  console.log('No match found for', authorName);
  return null;
}

async function journalDetailApi(fastify, opts) {
  fastify.get('/journal/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      console.log('Received ID:', id);
      const db = getDb();
      console.log('DB connected');

      // Handle both ObjectId and string IDs
      let query;
      try {
        query = { _id: new ObjectId(id) };
        console.log('Using ObjectId query:', query);
      } catch (e) {
        query = { _id: id };
        console.log('Using string query:', query);
      }

      const journal = await db.collection('journal').findOne(query);
      console.log('Journal found:', !!journal);

      if (!journal) {
        return reply.code(404).send({ error: 'Journal not found' });
      }

      // Ensure authors is an array
      if (!Array.isArray(journal.authors)) {
        return reply.code(500).send({ error: 'Invalid journal data: authors not an array' });
      }

      console.log('Authors:', journal.authors);
      const dosenCollection = db.collection('dosen');
      const authors = await Promise.all(
        journal.authors.map(async (name) => ({
          name,
          id: await findDosenId(name, dosenCollection)
        }))
      );

      console.log('Authors with IDs:', authors);
      reply.code(200).send({
        title: journal.title,
        authors,
        publicationYear: journal.publicationYear,
        publicationName: journal.publicationName,
        citation: journal.citation,
        doi: journal.doi
      });
    } catch (error) {
      console.error('Caught error:', error);
      fastify.log.error('Error fetching journal detail:', error.message || error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = { journalDetailApi };
