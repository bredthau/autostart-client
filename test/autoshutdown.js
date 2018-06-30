const http          = require("http");
const path          = require("path");
const assert        = require("chai").assert;
const cp            = require("child_process");
const util          = require("util");
const parallel         = require("mocha.parallel");
function exec(descr, run) { run(); }
describe("autoShutdown", () => {

    const autoshutdown   = require("../index.js");
    function timeDiff(start) {
        return (new Date()).getTime() - start.getTime();
    }

    function exec(file, params, cwd = ".") {
        return new Promise((res, rej) => {
            const p = cp.fork(file, params = [], {cwd, execArgv: []});
            let start = null;
            p.on("message", (m) => { if(m === "started") start = new Date()});
            p.on('close', (code) => code === 0 ? res({time: timeDiff(start), start: start}) : rej(code));
        });
    }
    function client(file, params, cwd = ".", src = null) {
        return new Promise((res, rej) => {
            const p = cp.fork(file, params = [], {cwd, execArgv: []});
            let start = null;
            p.on("message", (m) => { if(m.type === "#asc-ready") start = new Date()});
            p.send({type: "#asc-init", src});
            p.on('close', (code) => code === 0 ? res({time: timeDiff(start), start: start}) : rej(code));
        });
    }
    function assertBetween(val, min, max) {
        assert.isAtLeast(val, min);
        assert.isAtMost(val,  max);
    }
    function assertTime(start, min, max) {
        assertBetween(timeDiff(start), min, max);
    }

    function makeMakeShutdown(genSD) {
        return function makeShutdown() {
            const start = new Date();
            const sd = genSD({timeout: 0.1});
            sd.removeCleanup(autoshutdown.exit);
            const prom = new Promise((res, rej) => sd.addCleanup(res));
            return {shutdown: sd, promise: prom, start};
        }
    }
    const makeShutdown = makeMakeShutdown(autoshutdown.autoShutdown);
    parallel("shutdown", () => {
        it("simple", async () => {
            const {promise, start} = makeShutdown();
            await promise;
            assertBetween(timeDiff(start), 100, 300);
        });

        it("reset", async () => {
            const {shutdown, promise, start} = makeShutdown();
            for(let i = 1; i < 5; ++i)
                setTimeout(() => shutdown.resetTimer(), i * 50);
            await promise;
            assertBetween(timeDiff(start), 300, 500);
        });
        it("disabled-reset", async () => {
            const {shutdown, promise, start} = makeShutdown();
            shutdown.removeCheck(shutdown.activityCheck);
            for(let i = 1; i < 5; ++i)
                setTimeout(() => shutdown.resetTimer(), i * 50);
            await promise;
            assertBetween(timeDiff(start), 95, 300);//sometimes goes down to 99 due to parallel exec
        });
        it("stop", async () => {
            const {shutdown, promise, start} = makeShutdown();
            shutdown.stop();
            setTimeout(() => shutdown.start(), 200);
            await promise;
            assertBetween(timeDiff(start), 300, 500);
        });
        it("double-stop", async () => {
            const {shutdown, promise, start} = makeShutdown();
            shutdown.stop();
            shutdown.stop();
            setTimeout(() => shutdown.start(), 200);
            await promise;
            assertBetween(timeDiff(start), 300, 500);
        });
        it("empty-detach", async () => {
            const {shutdown, promise, start} = makeShutdown();
            assert.doesNotThrow(() => shutdown.detach({}));
            await promise;
            assertBetween(timeDiff(start), 100, 300);
        });

        it("promise-check", async () => {
            const {shutdown, promise, start} = makeShutdown();
            shutdown.addCheck(() => new Promise((res, rej) => res(timeDiff(start) > 300)));
            await promise;
            assertBetween(timeDiff(start), 300, 500);
        });

    });

    describe("shutdown-server", () => {

        it("simple-server", async () => {
            const {shutdown, promise, start} = makeShutdown();
            const server = http.createServer();
            shutdown.attachServer(server);
            await new Promise((res, rej) => server.on("close", res));
            assertBetween(timeDiff(start), 100, 300);
        });
        it("used-server", async () => {
            const {shutdown, promise, start} = makeShutdown();
            const server = await new Promise((res, rej) => {
                const server = http.createServer((req, res) => res.end('Hello World!'));
                server.listen(37821, () => res(server));
            });
            shutdown.attachServer(server);
            for(let i = 1; i < 5; ++i)
                setTimeout(() => http.get("http://localhost:37821"), i * 50);
            await new Promise((res, rej) => server.on("close", res));
            assertBetween(timeDiff(start), 300, 500);
        });
        it("detached-server", async () => {
            const {shutdown, promise, start} = makeShutdown();
            const server = await new Promise((res, rej) => {
                const server = http.createServer((req, res) => res.end('Hello World!'));
                server.listen(37821, () => res(server));
            });
            shutdown.attachServer(server);
            for(let i = 1; i < 5; ++i)
                setTimeout(() => http.get("http://localhost:37821"), i * 50);
            shutdown.detach(server);
            await promise;
            assertBetween(timeDiff(start), 100, 300);
            await new Promise((res, rej) => setTimeout(res, 6 * 50));
            server.close();
        });
    });
    const makeClient = makeMakeShutdown(autoshutdown.client);

    parallel("client", () => {
        it("simple", async () => {
            const {promise, start, shutdown} = makeClient();
            shutdown.start();
            await promise;
            assertBetween(timeDiff(start), 100, 300);
        });
    });
    parallel("shutdown childprocess", () => {
        it("simple", async () => {
            const {time} = await exec(path.join(__dirname, "clients/simple-shutdown.js"));
            assertBetween(time, 100, 300);
        });

        it("reset", async () => {
            const {time} = await exec(path.join(__dirname, "clients/reseted-shutdown.js"));
            assertBetween(time, 300, 500);
        });
    });

    parallel("client childprocess", () => {
        it("simple", async () => {
            const {time} = await client(path.join(__dirname, "clients/simple-client.js"));
            assertBetween(time, 100, 300);
        });
        it("deferred", async () => {
            const start = new Date();
            const {time} = await client(path.join(__dirname, "clients/deferred-client.js"));
            assertBetween(time, 100, 300);
            assert.isAbove(timeDiff(start), 600);
        });


    });
});