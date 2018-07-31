"use strict";
const shutdown = require("../../index.js");
process.send("started");
shutdown.autoShutdown({timeout: 0.1});