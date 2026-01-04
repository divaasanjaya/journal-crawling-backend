const { spawn } = require('child_process');
const path = require('path');

async function searchingApi(fastify, opts) {
  // API endpoint to perform semantic search using NLP model
  fastify.get('/search', async (request, reply) => {
    const { q: query, top_k = 100 } = request.query;

    if (!query) {
      return reply.code(400).send({ error: 'Query parameter "q" is required' });
    }

    try {
      // Path to the Python script
      const scriptPath = path.join(__dirname, '../ai/search_journals.py');

      // Spawn Python process
      const pythonProcess = spawn('python', [scriptPath, query, top_k.toString()], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      return new Promise((resolve, reject) => {
        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            fastify.log.error('Python script error:', stderr);
            reply.code(500).send({ error: 'Search failed', details: stderr });
            return resolve();
          }

          try {
            console.log('Hasil stdout:', stdout);
            const results = JSON.parse(stdout);
            resolve(reply.code(200).send(results));
          } catch (parseError) {
            fastify.log.error('JSON parse error:', parseError);
            reply.code(500).send({ error: 'Invalid response format' });
            resolve();
          }
        });

        pythonProcess.on('error', (error) => {
          fastify.log.error('Process error:', error);
          reply.code(500).send({ error: 'Search process failed' });
          resolve();
        });
      });
    } catch (error) {
      fastify.log.error('Search error:', error);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

module.exports = { searchingApi };
