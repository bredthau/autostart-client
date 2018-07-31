"use strict";
const shutdown = require("../../index.js");
const sc = shutdown.client({timeout: 0.1, deferInit: true});
setTimeout(() => sc.finishInitialization(), 500);
