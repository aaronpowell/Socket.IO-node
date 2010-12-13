var http = require('http')
  , net = require('net')
  , io = require('socket.io')
  , port = 7100
  , Listener = io.Listener
  , WebSocket = require('./../support/node-websocket-client/lib/websocket').WebSocket;

require('socket.io/tests');

function listen(s, callback){
  s._port = port;
  s.listen(port, callback);
  port++;
  return s;
};

module.exports = {
  
  'test serving static javascript client': function(assert){
    var _server = server()
      , _socket = socket(_server);
    assert.response(_server
     , { url: '/socket.io/socket.io.js' }
     , { body: /setPath/, headers: { 'Content-Type': 'text/javascript' }});
    assert.response(_server
     , { url: '/socket.io/lib/vendor/web-socket-js/WebSocketMain.swf' }
     , { headers: { 'Content-Type': 'application/x-shockwave-flash' }}
     , function(resp){
       assert.type(resp.headers.etag, 'string');
       assert.response(_server
        , { url: '/socket.io/lib/vendor/web-socket-js/WebSocketMain.swf', headers: { 'If-None-Match': resp.headers.etag } }
        , { status: 304 });
     });
     assert.response(_server
      , { url: '/socket.io/WebSocketMain.swf' }
      , { headers: { 'Content-Type': 'application/x-shockwave-flash' }});
  },
  
  'test serving non-socket.io requests': function(assert){
    var _server = server()
      , _socket = socket(_server);
    _server.on('request', function(req, res){
      if (req.url == '/test'){
        res.writeHead(200);
        res.end('Hello world');
      }
    });
    assert.response(_server
     , { url: '/test' }
     , { body: 'Hello world' });
  },
  
  'test destroying an upgrade connection that is not WebSocket': function(assert){
    var _server = server()
      , _socket = socket(_server);
    listen(_server, function(){
      var client = http.createClient(_server._port)
        , request = client.request('/', {
            'Connection': 'Upgrade',
            'Upgrade': 'IRC'
          })
        , upgraded = false;
      client.addListener('upgrade', function(){
        upgraded = true;
      });
      client.addListener('end', function(){
        assert.ok(! upgraded);
        _server.close();
      })
      request.end();
    });
  },
  
  'test broadcasting to clients': function(assert){
    var _server = server()
      , _socket = socket(_server);
    listen(_server, function(){
      var _client1 = client(_server)
        , _client2 = client(_server)
        , trips = 2
        , expected = 2;
      
      _socket.on('connection', function(conn){
        --expected || _socket.broadcast('broadcasted msg');
      });
        
      function close(){
        _client1.close();
        _client2.close();
        _server.close();
      };
        
      _client1.onmessage = function(ev){
        if (!_client1._first){
          _client1._first = true;
        } else {
          decode(ev.data, function(msg){
            assert.ok(msg[0] === 'broadcasted msg');
            --trips || close();
          });
        }
      };
      _client2.onmessage = function(ev){
        if (!_client2._first){
          _client2._first = true;
        } else {
          decode(ev.data, function(msg){
            assert.ok(msg[0] === 'broadcasted msg');
            --trips || close();
          });
        }
      };
    })
  },
  
  'test connecting with an invalid sessionid': function(assert){
    var _server = server()
      , _socket = socket(_server);
    listen(_server, function(){
      var _client = client(_server, 'fake-session-id')
        , gotMessage = false;
      _client.onmessage = function(){
        gotMessage = true;
      };
      setTimeout(function(){
        assert.ok(!gotMessage);
        _server.close();
      }, 200);
    });
  },
  
  'test connecting to an invalid transport': function(assert){
    var _server = server(function(req, res){
          res.writeHead(200);
          res.end(req.url == '/socket.io/inexistent' ? 'All cool' : '');
        })
      , _socket = socket(_server);
    
    assert.response(_server, { url: '/socket.io/inexistent' }, { body: 'All cool' });
  },

  'test realms': function(assert){
    var _server = server()
      , _socket = socket(_server)
      , globalMessages = 0
      , messages = 2;

    listen(_server, function(){
      _socket.on('connection', function(conn){
        conn.on('message', function(msg){
          globalMessages++;
          if (globalMessages == 1)
            assert.ok(msg == 'for first realm');
          if (globalMessages == 2)
            assert.ok(msg == 'for second realm');
        });
      });

      var realm1 = _socket.realm('first-realm')
        , realm2 = _socket.realm('second-realm');

      realm1.on('connection', function(conn){
        conn.on('message', function(msg){
          assert.ok(msg == 'for first realm');
          --messages || close();
        });
      });

      realm2.on('connection', function(conn){
        conn.on('message', function(msg){
          assert.ok(msg == 'for second realm');
          --messages || close();
        });
      });

      var _client1 = client(_server)
        , _client2;

      _client1.onopen = function(){
        var once = false;
        _client1.onmessage = function(){
          if (!once){
            once = true;
            _client1.send(encode('for first realm', {r: 'first-realm'}));

            _client2 = client(_server)
            _client2.onopen = function(){
              var once = false;
              _client2.onmessage = function(){
                if (!once){
                  once = true;
                  _client2.send(encode('for second realm', {r: 'second-realm'}));
                }
              };
            };
          }
        };
      };

      function close(){
        _client1.close();
        _client2.close();
        _server.close();
      }
    });
  },

  'test accessing all connected clients': function(assert) {
	var _server = server()
	  , _socket = socket(_server);
	
	listen(_server, function() {
		var _client1 = client(_server)
		  , _client2 = client(_server);

		assert.ok(listen.clients().length === 2);
		_client1.close();
		_client2.close();
		_server.close();
		});
  },
  
  'test broadcasting to select clients': function(assert){
    var _server = server()
      , _socket = socket(_server);
    listen(_server, function(){
      var _client1 = client(_server)
        , _client2 = client(_server)
        , trips = 2
        , expected = 2;
      
      _socket.on('connection', function(conn){
        --expected || _socket.broadcast('broadcasted msg', function(client, i) {
			return i % 2;
		});
      });
        
      function close(){
        _client1.close();
        _client2.close();
        _server.close();
      };
        
      _client1.onmessage = function(ev){
        if (!_client1._first){
          _client1._first = true;
        } else {
          decode(ev.data, function(msg){
            assert.ok(msg[0] === 'broadcasted msg');
            --trips || close();
          });
        }
      };
      _client2.onmessage = function(ev){
        if (!_client2._first){
          _client2._first = true;
        } else {
          decode(ev.data, function(msg){
            assert.ok(msg[0] === 'broadcasted msg');
            --trips || close();
          });
        }
      };
    })
  }
};