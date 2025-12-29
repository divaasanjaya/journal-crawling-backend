// --- Scholar Selenium Automation ---
function startScholarSelenium({ query, count, mongoUri, output }) {
    const id = `scholar-job-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    jobs[id] = { id, status: 'running', startedAt: new Date().toISOString(), stdout: '', stderr: '' };
    persistJobToDb(jobs[id]).catch(() => {});

    const script = path.resolve(__dirname, '../../../crawlers/scholar/google-scholar-crawler/googlescholar/scholar_selenium.py');
    const args = [script];
    if (query) args.push('--query', query);
    if (count) args.push('--count', String(count));
    if (mongoUri) args.push('--mongoUri', mongoUri);
    if (output) args.push('--output', output);

    console.log(`SCHOLAR JOB: spawning process: python ${args.join(' ')}`);
    const proc = spawn('python', args, { windowsHide: true });
    console.log(`SCHOLAR JOB: spawned pid=${proc.pid} for job ${id}`);

    proc.stdout.on('data', d => {
        const txt = d.toString();
        jobs[id].stdout += txt;
        console.log(`SCHOLAR JOB:${id}:stdout: ${txt.replace(/\n/g, '\\n')}`);
        broadcastToJob(id, JSON.stringify({ stream: 'stdout', text: txt }));
    });
    proc.stderr.on('data', d => {
        const txt = d.toString();
        jobs[id].stderr += txt;
        console.error(`SCHOLAR JOB:${id}:stderr: ${txt.replace(/\n/g, '\\n')}`);
        broadcastToJob(id, JSON.stringify({ stream: 'stderr', text: txt }), 'stderr');
    });

    proc.on('close', async code => {
        jobs[id].status = code === 0 ? 'finished' : 'failed';
        jobs[id].exitCode = code;
        jobs[id].finishedAt = new Date().toISOString();
        await persistJobToDb(jobs[id]);
        console.log(`SCHOLAR JOB:${id} finished status=${jobs[id].status} exit=${code}`);
        broadcastToJob(id, JSON.stringify({ event: 'finished', exitCode: jobs[id].exitCode }), 'finished');
        if (jobSubscribers[id]) {
            for (const res of Array.from(jobSubscribers[id])) unsubscribeJob(id, res);
            delete jobSubscribers[id];
        }
    });
    proc.on('error', async err => {
        jobs[id].status = 'failed';
        jobs[id].stderr += err.message;
        jobs[id].finishedAt = new Date().toISOString();
        await persistJobToDb(jobs[id]);
        broadcastToJob(id, JSON.stringify({ event: 'error', message: err.message }), 'error');
        if (jobSubscribers[id]) {
            for (const res of Array.from(jobSubscribers[id])) unsubscribeJob(id, res);
            delete jobSubscribers[id];
        }
    });
    return jobs[id];
}
const runPython = require("../../utils/runPython.js");
const path = require("path");
const { spawn } = require('child_process');
const { getDb } = require('../../db');

async function runScopus(keyword = "Telkom University", limit = 50) {
        const script = path.resolve(__dirname, "../../../crawlers/scopus/run.py");
        const output = await runPython(script, [keyword, String(limit)]);

        try {
                return JSON.parse(output);
        } catch (err) {
                throw new Error("Invalid JSON returned from Python crawler: " + err.message);
        }
}

// Simple in-memory job store for background Node crawler runs
const jobs = {}; // id -> { id, status, startedAt, finishedAt, stdout, stderr, exitCode, result }
// SSE subscribers per jobId
const jobSubscribers = {}; // id -> Set<res>

function subscribeJob(id, res) {
    if (!jobSubscribers[id]) jobSubscribers[id] = new Set();
    jobSubscribers[id].add(res);
}

function unsubscribeJob(id, res) {
    if (!jobSubscribers[id]) return;
    jobSubscribers[id].delete(res);
    try { res.end(); } catch (e) {}
}

function broadcastToJob(id, data, event) {
    const subs = jobSubscribers[id];
    if (!subs || subs.size === 0) return;
    const payload = (event ? `event: ${event}\n` : '') + `data: ${data.replace(/\n/g, '\\n')}\n\n`;
    for (const res of Array.from(subs)) {
        try { res.write(payload); } catch (e) { unsubscribeJob(id, res); }
    }
}

async function persistJobToDb(job) {
    try {
        const db = getDb();
        const coll = db.collection('jobs');
        await coll.updateOne({ id: job.id }, { $set: job }, { upsert: true });
    } catch (err) {
        console.error('persistJobToDb error:', err && err.message ? err.message : err);
    }
}

function startScopusApi({ affil, startYear, endYear, count, all, mongoUri, skipFile, maxStart, start }) {
    const id = `job-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    jobs[id] = { id, status: 'running', startedAt: new Date().toISOString(), stdout: '', stderr: '' };
    // persist initial job (DB connection should be initialized in server)
    persistJobToDb(jobs[id]).catch(() => {});

    console.log(`JOB: created ${id} affil=${affil} years=${startYear || ''}-${endYear || ''} all=${!!all} count=${count || ''}`);

    const script = path.resolve(__dirname, "../../../crawlers/scopus_api/run.js");
    const args = [script];
    if (affil) args.push(`--affil=${affil}`);
    if (startYear) args.push(`--startYear=${startYear}`);
    if (endYear) args.push(`--endYear=${endYear}`);
    if (all) args.push('--all');
    else if (count) args.push(`--count=${count}`);
    if (mongoUri) args.push(`--mongoUri=${mongoUri}`);
    if (skipFile) args.push(`--skipFile=${skipFile}`);
    if (typeof maxStart !== 'undefined') args.push(`--maxStart=${maxStart}`);
    if (typeof start !== 'undefined') args.push(`--start=${start}`);

    console.log(`JOB: spawning process: ${process.execPath} ${args.join(' ')}`);
    const proc = spawn(process.execPath, args, { windowsHide: true });

    console.log(`JOB: spawned pid=${proc.pid} for job ${id}`);

    proc.stdout.on('data', d => {
        const txt = d.toString();
        jobs[id].stdout += txt;
        // also log to server console
        console.log(`JOB:${id}:stdout: ${txt.replace(/\n/g, '\\n')}`);
        // stream to subscribers
        broadcastToJob(id, JSON.stringify({ stream: 'stdout', text: txt }));
    });
    proc.stderr.on('data', d => {
        const txt = d.toString();
        jobs[id].stderr += txt;
        console.error(`JOB:${id}:stderr: ${txt.replace(/\n/g, '\\n')}`);
        broadcastToJob(id, JSON.stringify({ stream: 'stderr', text: txt }), 'stderr');
    });

    proc.on('close', async code => {
        jobs[id].status = code === 0 ? 'finished' : 'failed';
        jobs[id].exitCode = code;
        jobs[id].finishedAt = new Date().toISOString();
        // try to parse last JSON array from stdout
        try {
            const out = jobs[id].stdout.trim();
            const idx = out.lastIndexOf('[');
            let parsed = null;
            if (idx !== -1) {
                parsed = JSON.parse(out.slice(idx));
            } else {
                parsed = JSON.parse(out);
            }
            jobs[id].result = { count: Array.isArray(parsed) ? parsed.length : null };
        } catch (e) {
            jobs[id].result = { error: 'no-json' };
        }
        await persistJobToDb(jobs[id]);
        console.log(`JOB:${id} finished status=${jobs[id].status} exit=${code}`);
        // notify subscribers job finished
        broadcastToJob(id, JSON.stringify({ event: 'finished', exitCode: jobs[id].exitCode }), 'finished');
        // close all subscribers
        if (jobSubscribers[id]) {
            for (const res of Array.from(jobSubscribers[id])) unsubscribeJob(id, res);
            delete jobSubscribers[id];
        }
    });

    proc.on('error', async err => {
        jobs[id].status = 'failed';
        jobs[id].stderr += err.message;
        jobs[id].finishedAt = new Date().toISOString();
        await persistJobToDb(jobs[id]);
        broadcastToJob(id, JSON.stringify({ event: 'error', message: err.message }), 'error');
        if (jobSubscribers[id]) {
            for (const res of Array.from(jobSubscribers[id])) unsubscribeJob(id, res);
            delete jobSubscribers[id];
        }
    });

    return jobs[id];
}

async function getJob(id) {
    if (jobs[id]) return jobs[id];
    try {
        const db = getDb();
        const coll = db.collection('jobs');
        const doc = await coll.findOne({ id });
        return doc || null;
    } catch (err) {
        console.error('getJob error:', err && err.message ? err.message : err);
        return null;
    }
}

module.exports = { runScopus, startScopusApi, startScholarSelenium, getJob, subscribeJob, unsubscribeJob };