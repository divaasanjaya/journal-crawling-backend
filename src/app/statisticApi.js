const { getDb } = require('../db');
const path = require('path');

async function statisticApi(fastify, opts) {
  // Single API endpoint to get all statistics: publications per year, citations per year, and top topics
  fastify.get('/statistic', async (request, reply) => {
    try {
      const db = getDb();
      const collection = db.collection('journal');

      // Aggregate for publications per year
      const pubPipeline = [
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
      const pubResults = await collection.aggregate(pubPipeline).toArray();
      const publicationsPerYear = {};
      pubResults.forEach(result => {
        publicationsPerYear[result._id] = result.count;
      });

      // Aggregate for citations per year
      const citPipeline = [
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
      const citResults = await collection.aggregate(citPipeline).toArray();
      const citationsPerYear = {};
      citResults.forEach(result => {
        citationsPerYear[result._id] = result.totalCitations;
      });

      // Get top topics
      const fs = require('fs');
      const topicsPath = path.join(__dirname, '../../', 'models', 'top_topics.json');
      const topicsData = fs.readFileSync(topicsPath, 'utf8');
      const topics = JSON.parse(topicsData);
      const topTopics = topics.slice(0, 5).map(topic => ({
        topic: topic.topic_name,
        count: topic.count
      }));

      reply.code(200).send({
        status: true,
        publicationsPerYear,
        citationsPerYear,
        topTopics
      });
    } catch (error) {
      fastify.log.error('Error fetching statistics:', error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = { statisticApi };
