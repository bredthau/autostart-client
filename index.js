const Data             = Symbol("Data");
const ScheduleShutdown = Symbol("ScheduleTimeouts");
const log = () => {};//console.log.bind(console);
function cleanup(cleanups, start = 0) {
    for(let i = start; i < cleanups.length; ++i) {
        const res = cleanups[i]();
        if(res && res.then)
            return res.then(() => cleanup(cleanups, i+1));
    }
}
function check(checks, start = 0) {
    for(let i = start; i < checks.length; ++i) {
        const res = checks[i]();
        if(typeof res === "object" || res.then)
            return res.then((v) => {
                if(!v) return false;
                else   return check(checks, i+1);
            });
        if(!res)
            return Promise.resolve(false);
    }
    return Promise.resolve(true);
}
function defer() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}


class AutoShutdown {
    constructor({ timeout = 3600, checks = [], cleanups = []} = {}) {
        this[Data] = {
            activity: 0,
            checks:   new Set(checks),
            cleanups: new Set(cleanups),
            timeout:  timeout,
            baseCheck() { return data.activity === 0; },
            handle:   0,
            attached: new WeakMap()
        };
        const data = this[Data];
        this.addCheck(this[Data].baseCheck);
        this.addCleanup(AutoShutdown.exit);
        this.start();
    }
    stop() {
        if(this[Data].handle)
            clearTimeout(this[Data].handle);
        this[Data].handle = 0;
        log && log(`Disabled shutdown`);
        return this;
    }
    start() {
        log && log(`Enabled shutdown`);
        this[Data].activity = 1;
        this[Data].handle = setTimeout(() => this[ScheduleShutdown](), 1000 * this[Data].timeout);
        return this;
    }
    shutdown() {
        log && log("shutdown");
        cleanup(Array.from(this[Data].cleanups).reverse());
        return this;
    }
    [ScheduleShutdown] () {
        check(Array.from(this[Data].checks), 0).then(success => {
            if(!success) {
                log && log(`Reschedule shutdown with timeout ${this[Data].timeout}`);
                this[Data].activity = 0;
                this[Data].handle = setTimeout(() => this[ScheduleShutdown](), 1000 * this[Data].timeout);
                return;
            }
            this.shutdown();
        });
    }
    get activityCheck()   { return this[Data].baseCheck; }

    static exit /* istanbul ignore next */ ()   { process.exit(0); }
    resetTimer()          { ++this[Data].activity; return this; }
    addCheck(check)       { this[Data].checks.add(check);        return this; }
    removeCheck(check)    { this[Data].checks.delete(check);     return this; }
    addCleanup(cleanup)   { this[Data].cleanups.add(cleanup);    return this; }
    removeCleanup(cleanup){ this[Data].cleanups.delete(cleanup); return this; }
    attach(attachment, checks = [], cleanups = [], actions = []) {
        checks.forEach(  x => this.addCheck(x));
        cleanups.forEach(x => this.addCleanup(x));
        this[Data].attached.set(attachment, {checks, cleanups, actions});
        return this;
    }
    attachServer(server) {
        const onReq = () => this.resetTimer();
        const check = () => new Promise((res, rej) => server.getConnections((err, cnt) => res(!err && cnt === 0)));
        const clean = () => new Promise((res, rej) => server.close(() => res()));
        server.on('connect', onReq);
        server.on('request', onReq);
        return this.attach(server, [check], [clean], [() => ["request", "connect"].map(event => server.removeListener(event, onReq))]);
    }
    detach(attach) {
        const attached = this[Data].attached.get(attach);
        if(!attached)
            return;
        attached.checks.forEach(x => this.removeCheck(x));
        attached.cleanups.forEach(x => this.removeCleanup(x));
        attached.actions.forEach(x => x());
        this[Data].attached.delete(attach);
        return this;
    }
}
function isClient() { return !!process.send; }
const ClientData = Symbol("ClientData");
class AutoStartClient extends AutoShutdown {
    constructor(opts = {}) {
        super(opts);
        const [socketP, dataP] = [defer(), defer()];
        this[ClientData] = {
            init:        defer(),
            socket:      socketP.promise,
            data:        dataP.promise
        };
        this.stop();
        /* istanbul ignore if */
        if(isClient())
            process.on("message", m => {
                if(!m)
                    return;
                if(m.type === "#asc-init") {
                    socketP.resolve(m.src);
                    dataP.resolve(m.data || {});
                    this[ClientData].init.promise.then(() => this.start());
                } else if(m.type === "#asc-exit")
                    this.shutdown();
            });
        /* istanbul ignore else */
        if(!opts.deferInit)
           this.finishInitialization();
    }

    get socket /* istanbul ignore next */ () { return this[ClientData].socket; }
    get data   /* istanbul ignore next */ () { return this[ClientData].data; }
    finishInitialization() {
        /* istanbul ignore if */
        if(isClient())
            process.send({type: "#asc-ready"});
        this[ClientData].init.resolve();
        return this;
    }
}

module.exports = {
    autoShutdown(opts) { return new AutoShutdown(opts); },
    client(opts)       { return new AutoStartClient(opts); },
    exit: AutoShutdown.exit
};