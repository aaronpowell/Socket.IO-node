var url = require('url')
  , sys = require('sys')
  , fs = require('fs')
  , options = require('./utils').options
  , Realm = require('./realm')
  , Client = require('./client')
  , clientVersion = require('./../../support/socket.io-client/lib/io').io.version
  , transports = {
      'flashsocket': require('./transports/flashsocket')
    , 'htmlfile': require('./transports/htmlfile')
    , 'websocket': require('./transports/websocket')
    , 'xhr-multipart': require('./transports/xhr-multipart')
    , 'xhr-polling': require('./transports/xhr-polling')
    , 'jsonp-polling': require('./transports/jsonp-polling')
    };

var Listener = module.exports = function(server, options){
  process.EventEmitter.call(this);
  var self = this;
  this.server = server;
  this.options({
    origins: '*:*',
    resource: 'socket.io',
    flashPolicyServer: true,
    transports: ['websocket', 'flashsocket', 'htmlfile', 'xhr-multipart', 'xhr-polling', 'jsonp-polling'],
    transportOptions: {},
    log: sys.log
  }, options);
  
  if (!this.options.log) this.options.log = function(){};

  this.clients = {};
  this._clientCount = 0;
  this._clientFiles = {};
  this._realms = {};
  
  var listeners = this.server.listeners('request');
  this.server.removeAllListeners('request');
  
  this.server.addListener('request', function(req, res){
    if (self.check(req, res)) return;
    for (var i = 0, len = listeners.length; i < len; i++){
      listeners[i].call(this, req, res);
    }
  });
  
  this.server.addListener('upgrade', function(req, socket, head){
    if (!self.check(req, socket, true, head)){
      socket.end();
      socket.destroy();
    }
  });
  
  for (var i in transports)
    if ('init' in transports[i]) transports[i].init(this);
  
  this.options.log('socket.io ready - accepting connections');
};

sys.inherits(Listener, process.EventEmitter);
for (var i in options) Listener.prototype[i] = options[i];

Listener.prototype.broadcast = function(message, except, atts){
  for (var i = 0, k = Object.keys(this.clients), l = k.length; i < l; i++){
    if (!except || ((typeof except == 'number' || typeof except == 'string') && k[i] != except)
                || (Array.isArray(except) && except.indexOf(k[i]) == -1)){
	  if(filter) {
	  	if(filter(this.clients[k[i]], i)) {
	  		this.clients[k[i]].send(message, atts);
	  	}
	  } else {
	  	this.clients[k[i]].send(message, atts);
	  }
    }
  }
  return this;
};

Listener.prototype.broadcastJSON = function(message, except, atts){
  atts = atts || {};
  atts['j'] = null;
  return this.broadcast(JSON.stringify(message), except, atts);
};

Listener.prototype.check = function(req, res, httpUpgrade, head){
  var path = url.parse(req.url).pathname, parts, cn;
  if (path && path.indexOf('/' + this.options.resource) === 0){
    parts = path.substr(1).split('/');
    if (this._serveClient(parts.slice(1).join('/'), req, res)) return true;
    if (!(parts[1] in transports)) return false;
    if (parts[2]){
      cn = this.clients[parts[2]];
      if (cn){
        cn._onConnect(req, res);
      } else {
        req.connection.end();
        req.connection.destroy();
        this.options.log('Couldnt find client with session id "' + parts[2] + '"');
      }
    } else {
      this._onConnection(parts[1], req, res, httpUpgrade, head);
    }
    return true;
  }
  return false;
};

Listener.prototype._serveClient = function(file, req, res){
  var self = this
    , clientPaths = {
        'socket.io.js': 'socket.io.js',
        'lib/vendor/web-socket-js/WebSocketMain.swf': 'lib/vendor/web-socket-js/WebSocketMain.swf', // for compat with old clients
        'WebSocketMain.swf': 'lib/vendor/web-socket-js/WebSocketMain.swf'
      }
    , types = {
        swf: 'application/x-shockwave-flash',
        js: 'text/javascript'
      };
  
  function write(path){
    if (req.headers['if-none-match'] == clientVersion){
      res.writeHead(304);
      res.end();
    } else {
      res.writeHead(200, self._clientFiles[path].headers);
      res.end(self._clientFiles[path].content, self._clientFiles[path].encoding);
    }
  };
  
  var path = clientPaths[file];
  
  if (req.method == 'GET' && path !== undefined){
    if (path in this._clientFiles){
      write(path);
      return true;
    }
    
    fs.readFile(__dirname + '/../../support/socket.io-client/' + path, function(err, data){
      if (err){
        res.writeHead(404);
        res.end('404');
      } else {
        var ext = path.split('.').pop();
        self._clientFiles[path] = {
          headers: {
            'Content-Length': data.length,
            'Content-Type': types[ext],
            'ETag': clientVersion
          },
          content: data,
          encoding: ext == 'swf' ? 'binary' : 'utf8'
        };
        write(path);
      }
    });
    
    return true;
  }
  
  return false;
};

Listener.prototype.realm = function(realm){
  if (!(realm in this._realms))
    this._realms[realm] = new Realm(realm, this);
  return this._realms[realm];
}

Listener.prototype._onClientConnect = function(client){
  this.clients[client.sessionId] = client;
  this.options.log('Client '+ client.sessionId +' connected');
  this.emit('connection', client);
};

Listener.prototype._onClientDisconnect = function(client){
  delete this.clients[client.sessionId];
  this.options.log('Client '+ client.sessionId +' disconnected');
};

Listener.prototype._onConnection = function(transport, req, res, httpUpgrade, head){
  this.options.log('Initializing client with transport "'+ transport +'"');
  new transports[transport](this, req, res, this.options.transportOptions[transport], head);
};

Listener.prototype.clients = function(){
	return this.clients;
};