const { runScopus, startScopusApi, getJob } = require("./crawler.service");

async function crawlScopusHandler(request, reply) {
        const keyword = request.query.keyword || "Telkom University";
        const limit = parseInt(request.query.limit) || 50;

        try {
                const data = await runScopus(keyword, limit);
                return reply.send(data);
        } catch (err) {
                request.log && request.log.error && request.log.error(err);
                reply.status(500).send({ error: err.message });
        }
}

// Start Scopus API Node crawler as a background job
async function triggerScopusApiHandler(request, reply) {
    try {
        const affil = request.body.affil || request.query.affil || 'Telkom University';
        const startYear = request.body.startYear || request.query.startYear;
        const endYear = request.body.endYear || request.query.endYear;
        const all = request.body.all || request.query.all;
        const count = request.body.count || request.query.count;
        const mongoUri = request.body.mongoUri || request.query.mongoUri;

        const job = startScopusApi({ affil, startYear, endYear, count, all, mongoUri });
        return reply.code(202).send({ jobId: job.id, status: job.status, startedAt: job.startedAt });
    } catch (err) {
        request.log && request.log.error && request.log.error(err);
        reply.status(500).send({ error: err.message });
    }
}

async function getScopusJobHandler(request, reply) {
    const id = request.params.id;
    try {
        const job = await getJob(id);
        if (!job) return reply.status(404).send({ error: 'job not found' });
        return reply.send(job);
    } catch (err) {
        request.log && request.log.error && request.log.error(err);
        return reply.status(500).send({ error: err.message });
    }
}

// SSE logs for a running job
async function streamScopusJobLogsHandler(request, reply) {
    const id = request.params.id;
    const { res } = reply.raw ? { res: reply.raw } : { res: reply.raw };
    const job = await getJob(id);
    if (!job) return reply.status(404).send({ error: 'job not found' });

    // set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    res.write(':ok\n\n');

    // send existing logs chunk
    if (job.stdout) res.write(`data: ${JSON.stringify({ stream: 'stdout', text: job.stdout })}\n\n`);
    if (job.stderr) res.write(`event: stderr\ndata: ${JSON.stringify({ stream: 'stderr', text: job.stderr })}\n\n`);

    // subscribe
    const { subscribeJob, unsubscribeJob } = require('./crawler.service');
    subscribeJob(id, res);

    // cleanup on client close
    req = request.raw;
    req.on('close', () => { try { unsubscribeJob(id, res); } catch (e) {} });

    // do not call reply.send — connection stays open
}

module.exports = { crawlScopusHandler, triggerScopusApiHandler, getScopusJobHandler, streamScopusJobLogsHandler };
