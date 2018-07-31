# Node-Autostart-Client
This library isintended as a client for [autostart-server](https://npmjs.org/autostart-server). It will automatically shutdown the node process after a defined period of inactivity.

Autostart-Server is inspired by socket-activation via [node-systemd](https://github.com/rubenv/node-systemd), being a pure node implementation of the concept, which is useful for systems where ``systemd`` is not an option. It will create ``net.Servers`` listening to the the specified sockets and start the corresponding server apps on activity, forwarding all traffic to that app. 

## Installation
This library requires __node v.7.6.0__ or higher. In principle it should work with node versions since __node v.6.5.0__, however the tests use newer features, so use at your own risk.

```
$ npm install autostart-client
```

## Usage

The following example will create a client with a timeout of 15 minutes and attach a http server to watch for inactivity

```js
const autostart = require("node-autostart-client");
const server    = require("http").createServer();
const client    = autostart.client({timeout: 15 * 60});
client.attachServer(server);
```

Features are grouped into the basic auto-shutdown functionality and the extended client features.

## AutoShutdown
An ``AutoShutdown`` instance contains a ``timeout``, a list of ``checks`` and a list of ``cleanups``. After every interval of ``timeout`` seconds it will execute registered ``check``. If all checks return truthy values, it will execute all ``cleanup`` actions in reverse order. ``checks`` and ``cleanups`` can be grouped into attachments for easier handling

An ``AutoShutdown`` is created using the ``autostart.autoShutdown(opts)`` function. ``opts`` is an object with the following members:
```
timeout     Timeout in seconds
checks      Iterable used to prefill checks   (default: [])
cleanups    Iterable used to prefill cleanups (default: []) 
attchments  Iterable containing attachments   (default: [])
```
In addition to the passed checks and cleanups ``autostart.exit`` will be added to cleanups and ``client.activityCheck`` is added to checks.

The following will create an ``AutoShutdown`` with a timeout of ``1000s``:
 
```js
const as = autostart.autoShutdown({timeout: 1000});
```

Unless indicated otherwise instance methods of an ``AutoShutdown`` return the same instance for chaining.

#### Manually adding and removing checks and cleanups
The ``addCheck(check)``, ``removeCheck(check)``, ``addCleanup(cleanup)`` and ``removeCleanup(cleanup)`` methods of an ``AutoShutdown`` Instance can be used to add respectively remove ``checks`` respectively ``cleanups``. ``checks`` and ``cleanups`` are all called with zero arguments. ``checks`` must return either a truthy value to indicate that the shutdown may proceed or a falsy value to stop it. Both ``checks`` and ``cleanups`` may return ``Promises`` in which case the execution will wait on the promise before continuing with further ``checks``/``cleanups`` and in the case of a check evaluate the resolve-value of the ``Promise`` to find out whether to proceed or not.  

```js
as.addCheck(() => users.count === 0);
as.addCleanup(async () => await db.close());//close database connection
```

#### Attachments
For typical operation there is often an object, e.g. a server or a database, which compels both ``checks`` and ``cleanups``. For easier handling an ``AutoShutdown`` allows to group these into so called ``attachments``. An ``attachment`` consists of an ``attachment-object``, typically something like a server or database-connection, which is simply used as a key to identify it, as well as a list of associated ``checks`` and ``cleanups``. Furthermore it contains a list of ``actions``, which are called in the case of removing an ``attachment`` for cleanup purposes. Manually attaching a http-server could for example be done like this:

 ```js
 let lastTime = new Date();
const onReq            = () => lastTime = new Date();
const checkTime        = () => (new Date()).getTime() > lastTime.getTime() + 15 * 60 * 1000;
const checkConnections = () => new Promise((res, rej) => server.getConnections((err, cnt) => res(!err && cnt === 0)));
const clean            = () => new Promise((res, rej) => server.close(() => res()));
server.on('request', onReq);
as.attach(server, [checkTime, checkConnections], [clean], [() => server.removeListener("request", onReq)]);
 ```
 
Calling ``as.detach(server)`` afterwards would remove everything added with the attachment from ``as``, as well as executing the action to remove the ``request`` listener from ``server``.

##### Custom Attachments

The ``autostart.Shutdown.registerAttachmentType(name, func)`` can be used to attach prebuild attachment functions. It will add ``func`` under the name ``"attach"+name`` to the prototype of ``AutoShutDown``. An attachment function for websockets via ``ws`` could e.g. look kile the following:

```js
autostart.Shutdown.registerAttachmentType("WebSocket", function attachWebSocket(server) {
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
   return this.attach(server, [check], [clean], [() => server.removeListener('connection', onConnect)]);
});
```

It would be called as:
```js
const ws = new WebSocket.Server({});
as.attachWebSocket(ws);
```

##### Prebuild attachments

For ease of use the common use case of attaching a node http-server has been bundled into the ``as.attachServer(server)`` method, which behaves similar to the code example, although it uses the ``connect`` event in order to support ``net.Server`` too.

Further predefined attachments can be activated by requiring files from  the ``attach`` subdirectory. Currently only the ``ws.js`` attachment is bundled, which registers an attachment named ``Websocket`` for websocket servers created using ``ws.js``.

Example:
```js
require("autostart-client/attach/ws");
const ws = new WebSocket.Server({});
as.attachWebSocket(ws);
```




 
#### Manual controls
For more finegrained control an ``AutoShutdown`` can be controlled manually. The ``as.stop()`` method will stop the timer so that no activity checks will be done anymore. ``as.start()`` can be used to restart the timer with and therefore restore control to the ``AutoShutdown``. Be advised that ``as.start()`` will not continue the previous interval, but start with the full ``timeout``. ``as.shutdown()`` can be used to manually trigger the cleanup independent of the current state of the timer.

#### Builtins
Each AutoShutdown automatically adds ``autostart.exit`` to it's ``cleanups`` on construction. ``autostart.exit`` will call ``process.exit(0)`` to exit the current program. It can be removed by calling ``as.removeCleanup(autostart.exit)``.

To simplify building checks there is also a builtin activity measure, which automatically check. This check can be removed using ``as.removeCheck(as.activityCheck)``. It queries an internal value, which can be set by calling ``as.resetTimer()``. Checking the time of the last connection from the server-attachment example could therefore be simplified to:
```js
server.on('request', () => as.resetTimer());
```

## AutoStartClient
An ``AutostartClient`` extends the functionality of an ``AutoShutdown`` with additional functionality to communicate with an ``autostart-server``. When started it will check, whether the application is launched from an ``autostart-server``, deactivating shutdown functionality using it's own ``.stop()`` method otherwise. This makes it easy to execute the script as a standalone in development, but seamlessly put it into an ``autostart-server`` for deployment.  

An ``AutoStartClient`` is created using the ``autostart.client(options)`` function. ``options`` is the same as when creating an ``AutoShutdown`` but also has the following property:
 ```
 deferInit   If false finishInitialization() will be called during construction (default: false)
 ```
 
 An ``AutoStartClient`` has all the methods of an ``AutoShutdown``. However unlike a plain ``AutoShutdown`` the timeout will not necessarily start on construction. Instead it will wait until both the ``#asc-init`` event has been sent from the ``autostart-server`` and ``client.finishInitialization()`` has been called. Besides starting the timeout ``client.finishInitialization()`` will send the ``#asc-ready`` event to the ``autostart-server``, signalling that the process is ready to receive connections. This means that ``client.finishInitialization()`` should only be called when the app is fully started and listens to its socket.
 
 ``AutoStartClients`` have the ``client.isClient`` property, which is a ``boolean`` indicating if the instance has been started as a client (via nodes ``child_process``) or not.
 
 #### Data
 ``AutoStartClient`` has the additional members ``client.socket``, ``client.connections`` and ``client.data``. All three are promises, which resolve to the data send from the server by the ``#asc-init`` event.

 * ``client.connections`` resolves to the array of all connections to the app as objects of ``.src`` and ``.dst``  
 * ``client.socket`` resolves to the main socket to which the autostart-server will forward its connections. This is equivalent to ``(await client.connections)[0].dst``
 * ``client.data`` contains further custom data coming from the app description.