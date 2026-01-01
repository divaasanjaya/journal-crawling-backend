const { getDb } = require('../db');
const { ObjectId } = require('mongodb');

function titleCase(str) {
  return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

async function authorDetailApi(fastify, opts) {
  fastify.get('/author/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const db = getDb();

      // Parse id as ObjectId
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch (e) {
        return reply.code(400).send({ error: 'Invalid ObjectId format' });
      }

      const dosen = await db.collection('dosen').findOne(query);

      if (!dosen) {
        return reply.code(404).send({ error: 'Author not found' });
      }

      // Return the specified fields
      reply.code(200).send({
        nama: titleCase(dosen.nama),
        affiliation: dosen.affiliation,
        department: dosen.department,
        article_scopus: dosen.article_scopus,
        article_gscholar: dosen.article_gscholar,
        article_wos: dosen.article_wos,
        citation_scopus: dosen.citation_scopus,
        citation_gscholar: dosen.citation_gscholar,
        citation_wos: dosen.citation_wos,
        hindex_scopus: dosen.hindex_scopus,
        hindex_gscholar: dosen.hindex_gscholar,
        hindex_wos: dosen.hindex_wos
      });
    } catch (error) {
      fastify.log.error('Error fetching author detail:', error.message || error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = { authorDetailApi };
