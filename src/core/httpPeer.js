/*
 * Copyright (c) 2018, Arm Limited and affiliates.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var request = require('request')
var url = require('url');
var EventEmitter = require('events').EventEmitter;
var DeviceJSPeer = require('./peer');
var uuid = require('node-uuid');
var socketioClient = require('socket.io-client');
var selection = require('./selection');

function makeUUIDHex() {
    var uuidBuffer = new Buffer(16);

    uuid.v4(null, uuidBuffer, 0);

    return uuidBuffer.toString('hex');
}

/**
 * A DeviceJS peer 
 *
 * @class DeviceJSPeer
 * @constructor
 * @param {String} serverAddress The IP of the DeviceJS server
 * @param {Object} peerOptions The configuration options for this peer
 */
var HTTPPeer = function(httpCoreServerAddress, options) {
    DeviceJSPeer.call(this, httpCoreServerAddress);

    var peerOptions = options.peer;
    
    this.https = options.https;
    this.pendingRequests = { };
    this.nextRequestID = 0;

    // Connections must use an api key and api secret
    // to identify and authorize applications
    if(typeof peerOptions === 'object' && typeof peerOptions.apiKey === 'string' && typeof peerOptions.apiSecret === 'string') {
        this.apiKey = peerOptions.apiKey;
        this.apiSecret = peerOptions.apiSecret;
    }
};

/**
 * Indicates that some peer has sent some sort of command to a resource
 * that is registered with this peer
 *
 * @event command
 * @param {String} commandName The name of the command to be executed
 * @param {Array} arguments The argument list associated with this command
 * @param {String} senderID The peer ID of the peer that made this request
 * @param {Number} commandID The command ID associated with this request
 * @param {Object} selectionInfo Information about which set of resources this command
 *   was sent to. Used for filtering and executing the command on all relevant resources.
 * @param {String} selectionInfo.selection
 */

/**
 * Indicates that some peer has sent a request to set the state of this
 * resource
 *
 * @event state set
 * @param {String} property The name of the state property to be modified
 * @param value The value to set this property to
 * @param {String} senderID The peer ID of the peer that made this request
 * @param {Number} commandID The command ID associated with this request
 * @param {Object} selectionInfo Information about which set of resources this request
 *   was sent to. Used for filtering and executing the command on all relevant resources.
 * @param {String} selectionInfo.selection
 */

/**
 * Indicates that some peer has sent a request to get the state of this
 * resource
 *
 * @event state get
 * @param {String} property The name of the state property to be retrieved
 * @param {String} senderID The peer ID of the peer that made this request
 * @param {Number} commandID The command ID associated with this request
 * @param {Object} selectionInfo Information about which set of resources this request
 *   was sent to. Used for filtering and executing the command on all relevant resources.
 * @param {String} selectionInfo.selection
 */

/**
 * Indicates a state change has been published from some resource
 * whose events this peer has subscribed to.
 *
 * @event state change
 * @param {String} resourceID The resource that published this state change
 * @param {String} property The name of the state property that changed
 * @param value The new value of the state property
 * @param {String} stateSubject The selection topic for which this event has been sent to this peer
 * @param {String} stateName
 * @param {String} selection The topic to which this state change is published
 */

/**
 * Indicates that a connection error occurred with the server
 *
 * @event error
 * @param error The error that occurred
 */

/**
 * The peer has a connection to the server
 *
 * @event connect
 */

/**
 * The peer has been disconnected from the server
 *
 * @event disconnect
 */

HTTPPeer.prototype = Object.create(DeviceJSPeer.prototype);

HTTPPeer.prototype.requiresAuth = function() {
    var self = this;
    
    return self.sendHTTPGet('/requiresAuth')
};

/**
 * Connect to the DeviceJS server and set up peer
 *
 * @method connect
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 * @example
 * ```
 * var djsClient = new devicejs.DeviceJSPeer(SERVER_URL, { });
 * djsClient.connect().then(function() {
 *     // successful connection. do more operations here
 * }, function(error) {
 *     // handle any connection errors here
 * });
 * ```
 */
HTTPPeer.prototype.connect = function() {
    var self = this;

    return this.disconnect().then(function() {
        // Obtains a token for doing future requests
        // and establishing a socket.io connection to the server
        // to use as a notification channel
        return self.sendHTTPPost('/token', {
        })
    }).then(function(token) {
        return new Promise(function(resolve, reject) {
            // Establish a socket.io connection, passing the
            // Token with the connection request. This is used
            // For authentication and to pair future HTTP requests
            // With our notification channel
            self.encodedToken = token;
            self.socket = socketioClient.connect(self.getServerAddress(), { 
                'forceNew': true,
                'query': 'encodedToken='+encodeURIComponent(token)
            });

            // A helper function that emits an event from this HTTP peer
            // object from an event name and an argument list
            function emit(eventName, argumentList) {
                var args = [ ];

                args.push(eventName);

                for(var i=0;i<argumentList.length;i++) {
                    args.push(argumentList[i]);
                }

                self.connectionEmitter.emit.apply(self.connectionEmitter, args);
            }
 
            self.socket.on('connect', function() {
            }).on('ok', function() {
                self.connectionEmitter.emit('connect');
                resolve();
            }).on('error', function(error) {
                self.connectionEmitter.emit('error', error);
                reject(error);
            }).on('disconnect', function() {
                self.connectionEmitter.emit('disconnect');
                reject();
            }).on('link up', function() {
                emit('link up', arguments);
            }).on('link down', function() {
                emit('link down', arguments);
            }).on('command', function() {
                emit('command', arguments);
            }).on('state set', function() {
                emit('state set', arguments);
            }).on('state get', function() {
                emit('state get', arguments);
            }).on('state change', function() {
                emit('state change', arguments);
            }).on('event', function() {
                emit('event', arguments);
            });
        });
    });
};

/**
 * Disconnect from the DeviceJS server. This object will
 * emit no further events. connect must be called again in order
 * to make requests to the server.
 *
 * @method disconnect
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 * @example
 * ```
 * var djsClient = new devicejs.DeviceJSPeer(SERVER_URL, { });
 * djsClient.connect().then(function() {
 *     ...
 *     djsClient.disconnect();
 *     ...
 * });
 * ```
 */
HTTPPeer.prototype.disconnect = function() {
    var self = this;

    Object.keys(self.pendingRequests).forEach(function(requestID) {
        self.pendingRequests[requestID].abort();
    });

    self.pendingRequests = { };

    return new Promise(function(resolve, reject) {
        if(self.socket) {
            try {
                self.emit('disconnect');
            }
            catch(e) {
            }

            self.socket.removeAllListeners('connect');
            self.socket.removeAllListeners('error');
            self.socket.removeAllListeners('disconnect');
            self.socket.removeAllListeners('reconnect');
            self.socket.removeAllListeners('reconnect_attempt');
            self.socket.removeAllListeners('reconnecting');
            self.socket.removeAllListeners('reconnect_error');
            self.socket.removeAllListeners('reconnect_failed');
            self.socket.removeAllListeners('command');
            self.socket.removeAllListeners('state set');
            self.socket.removeAllListeners('state get');
            self.socket.removeAllListeners('state change');
            self.socket.removeAllListeners('event');
            self.socket.disconnect();
            self.socket = null;
        }

        delete self.encodedToken; 

        resolve();
    });
};

HTTPPeer.prototype._newRequestOptions = function(options) {
    var _options = { };
    
    if(this.https && this.https.client) {
        for(var k in this.https.client) {
            _options[k] = this.https.client[k];
        }
    }
    
    for(var k in options) {
        _options[k] = options[k];
    }
    
    if(this.encodedToken) {
        _options.headers = _options.headers || { };
        _options.headers.authorization = 'Bearer ' + this.encodedToken;
    }
    
    _options.agentOptions = {
        checkServerIdentity: function(servername, cert) {
        }
    }
    
    return _options;
};

// A helper function that sends JSON encoded POST requests
// to the DeviceJS server
HTTPPeer.prototype.sendHTTPPost = function(path, body) {
    var self = this;

    return new Promise(function(resolve, reject) {
        request(self._newRequestOptions({
            uri: url.resolve(self.getServerAddress(), path),
            body: body,
            method: 'POST',
            json: true
        }), function(error, response, responseBody) {
            if(error) {
                reject(error);
            }
            else if(response.statusCode != 200) {
                reject({ status: response.statusCode, response: responseBody })
            }
            else {
                resolve(responseBody);
            }
        });
    });
};

// A helper function that sends JSON encoded GET requests
// to the DeviceJS server
HTTPPeer.prototype.sendHTTPGet = function(path) {
    var self = this;

    return new Promise(function(resolve, reject) {
        request(self._newRequestOptions({
            uri: url.resolve(self.getServerAddress(), path),
            method: 'GET',
            json: true
        }), function(error, response, responseBody) {
            if(error) {
                reject(error);
            }
            else if(response.statusCode != 200) {
                reject({ status: response.statusCode, response: responseBody })
            }
            else {
                resolve(responseBody);
            }
        });
    });
};

HTTPPeer.prototype.sendSocket = function(type, message) {
    if(this.socket) {
        this.socket.emit(type, message)
        return Promise.resolve()
    }
    else {
        return Promise.reject(new Error('No connection'))
    }
};

/**
 * NodeJS only. Returns the bearer token used by this client.
 * This is used by the browser->nodejs proxy application
 *
 * @method getBearerToken
 * @return {String} The bearer token
 */
HTTPPeer.prototype.getBearerToken = function() {
    return this.encodedToken;
};

module.exports = {
    DeviceJSPeer: HTTPPeer
};
