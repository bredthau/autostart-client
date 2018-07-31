"use strict";
const AS = require("../index.js");
AS.Shutdown.registerAttachmentType("WebSocket", function attachWebSocket(server) {
    let connections = 0;
    const closeConnection = () => { this.resetTimer(); --connections; };
    const onConnect = conn => {
        this.resetTimer();
        ++connections;
        conn.on("close", closeConnection);
    };
    const check = () => connections === 0;
    const clean = () => new Promise((res, rej) => server.close(() => res()));
    server.on('connection', onConnect);
    return this.attach(server, [check], [clean], [() => ["connection"].map(event => server.removeListener(event, onConnect))]);
});
