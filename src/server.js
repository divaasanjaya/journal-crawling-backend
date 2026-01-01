const fastify = require("fastify")({ logger: true });
const crawlerRoutes = require("./modules/crawler/crawler.routes");
const { publicationYearApi, citationYearApi } = require("./app/statisticApi");
const { journalDetailApi } = require("./app/journalDetailApi");
const { connect: connectDb, close: closeDb } = require('./db');

fastify.register(crawlerRoutes, { prefix: "/" });
fastify.register(publicationYearApi);
fastify.register(citationYearApi);
fastify.register(journalDetailApi);

const start = async () => {
	try {
		const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
		const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/journal_crawling';
		// connect DB before starting server; if DB unavailable, log and continue
		try {
			await connectDb(mongoUri);
		} catch (e) {
			fastify.log.warn('Database connection failed — continuing without DB: ' + (e && e.message ? e.message : e));
		}

		await fastify.listen({ port, host: "0.0.0.0" });

		// Register automation scheduler (daily cron) located in src/scheduler/crawler.js
		// The scheduler is responsible for starting crawl jobs on the configured cron
		// expression; the actual scheduling logic lives in that file so server.js
		// does not contain the crawling call directly.
		try {
			const scheduler = require('./scheduler/crawler');
			scheduler.startScheduler();
			fastify.log.info('Scheduler started');
		} catch (e) {
			fastify.log.error('Failed to start scheduler: ' + (e && e.message ? e.message : e));
		}

	} catch (err) {
		fastify.log.error(err);
		try { await closeDb(); } catch (e) {}
		process.exit(1);
	}
};

process.on('SIGINT', async () => {
  try { await closeDb(); } catch (e) {}
  process.exit(0);
});

start();

