"use strict";
const shutdown = require("../../index.js");
process.send("started");
const sd = shutdown.autoShutdown({timeout: 0.1});
for(let i = 1; i < 5; ++i) {
    setTimeout(() => sd.resetTimer(), i * 50);
}
