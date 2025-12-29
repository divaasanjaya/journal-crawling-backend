const { crawlScopusHandler, triggerScopusApiHandler, getScopusJobHandler, streamScopusJobLogsHandler } = require("./crawler.controller");

async function routes(fastify, opts) {
	fastify.get("/crawl/scopus", crawlScopusHandler);
	fastify.post("/crawl/scopus_api", { schema: { body: {} } }, triggerScopusApiHandler);
	fastify.get("/crawl/scopus_api/:id", getScopusJobHandler);
	fastify.get("/crawl/scopus_api/:id/logs", streamScopusJobLogsHandler);
}

module.exports = routes;
