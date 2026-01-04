const axios = require('axios');
const { isAuthorMatch } = require('../utils/authorMatcher');

async function searchingApi(fastify, opts) {
  // API endpoint to perform semantic search using NLP model via Flask
  fastify.get('/search', async (request, reply) => {
    const { q: query, top_k = 100, author } = request.query;

    if (!query) {
      return reply.code(400).send({ error: 'Query parameter "q" is required' });
    }

    try {
      // Call Flask API
      const flaskUrl = `http://localhost:5000/search?q=${encodeURIComponent(query)}&top_k=${top_k}`;
      const response = await axios.get(flaskUrl);

      let results = response.data;

      // 🔥 FILTER AUTHOR (jika ada)
      if (author) {
        results = results.filter(item =>
          Array.isArray(item.authors) &&
          item.authors.some(a => isAuthorMatch(author, a))
        );
      }

      reply.code(200).send(results);
    } catch (error) {
      fastify.log.error('Flask API error:', error.message);
      reply.code(500).send({ error: 'Search failed', details: error.message });
    }
  });
}

module.exports = { searchingApi };
