const { getDb } = require('../db');

async function publicationYearApi(fastify, opts) {
  // API endpoint to get publication count per year
  fastify.get('/statistic/publications-per-year', async (request, reply) => {
    try {
      const db = getDb();
      const collection = db.collection('journal');

      // Aggregate to count publications by publicationYear
      const pipeline = [
        {
          $match: {
            publicationYear: { $exists: true, $ne: null, $ne: '' }
          }
        },
        {
          $group: {
            _id: '$publicationYear',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ];

      const results = await collection.aggregate(pipeline).toArray();

      // Convert results to the desired format
      const publicationsPerYear = {};
      results.forEach(result => {
        publicationsPerYear[result._id] = result.count;
      });

      reply.code(200).send(publicationsPerYear);
    } catch (error) {
      fastify.log.error('Error fetching publications per year:', error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

async function citationYearApi(fastify, opts) {
  // API endpoint to get total citations per year
  fastify.get('/statistic/citations-per-year', async (request, reply) => {
    try {
      const db = getDb();
      const collection = db.collection('journal');

      // Aggregate to sum citations by publicationYear
      const pipeline = [
        {
          $match: {
            publicationYear: { $exists: true, $ne: null, $ne: '' },
            citation: { $exists: true, $type: 'number' }
          }
        },
        {
          $group: {
            _id: '$publicationYear',
            totalCitations: { $sum: '$citation' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ];

      const results = await collection.aggregate(pipeline).toArray();

      // Convert results to the desired format
      const citationsPerYear = {};
      results.forEach(result => {
        citationsPerYear[result._id] = result.totalCitations;
      });

      reply.code(200).send(citationsPerYear);
    } catch (error) {
      fastify.log.error('Error fetching citations per year:', error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = { publicationYearApi, citationYearApi };
