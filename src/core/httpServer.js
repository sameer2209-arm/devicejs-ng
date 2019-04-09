'use strict'

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

var http = require('http');
var https = require('https');
var express = require('express');
var bodyParser = require('body-parser');
var url = require('url');
var EventEmitter = require('events').EventEmitter;
var core = require('./core');
var DeviceJSCore = core.DeviceJSCore;
var uuid = require('node-uuid');
var socketio = require('socket.io');
var querystring = require('querystring');
var path = require('path');
var fs = require('fs');
var selection = require('./selection');
var coreLogger = require('./logging')('devicejs-core');
var discovery = require('./discovery');
var devicedb = require('../runtime/devicedb');
var ddb = devicedb({ });
var request = require('request');
var NodeMonitor = require('./nodeMonitor').NodeMonitor
var CloudTunnel = require('./cloudTunnel').CloudTunnel;
var ForwardingManager = require('./requestManager').ForwardingManager;
var bcrypt = require('bcrypt-nodejs');
var WigWagAuthorizer = require('relay-core').WigWagAuthorizer;
var CloudSubscriberRegistry = require('./cloudSubscriberRegistry');
var SubscriberRegistry = require('./registry').SubscriberRegistry;
var ResourceMonitor = require('./resourceMonitorController').ResourceMonitor;
var validate = require('jsonschema').validate;
var LinkGraph = require('./resourceLinkGraph')
var StateCache = require('./resourceStateCache')
var GraphUpdateSchema = require('./resourceLinkGraph').Schema

var ROUTING_TABLE_PREFIX = 'devicejs.core.routing';
var RESOURCE_OWNER_PREFIX = 'devicejs.core.resourceMapping';
var DEFAULT_LOCAL_PORT = 23242;

function makeUUIDHex() {
    var uuidBuffer = new Buffer(16);

    uuid.v4(null, uuidBuffer, 0);

    return uuidBuffer.toString('hex');
}

var HTTPCoreServer = function(httpPort, coreServerOptions) {
    var self = this;

    coreLogger.verbose('create port=%s, options=', httpPort, coreServerOptions);

    if(typeof coreServerOptions === 'object' && typeof coreServerOptions.moduleInstallDirectory !== 'string') {
        var moduleInstallDirectory = '/etc/devicejs/modules';
    }
    else {
        var moduleInstallDirectory = coreServerOptions.moduleInstallDirectory;
    }

    if(typeof coreServerOptions === 'object' && typeof coreServerOptions.https !== 'object') {
        var httpsOptions = this.httpsOptions = { };
    }
    else {
        var httpsOptions = this.httpsOptions = coreServerOptions.https;
    }

    if(typeof coreServerOptions === 'object' && typeof coreServerOptions.authService !== 'object') {
        var authServiceOptions = { };
    }
    else {
        var authServiceOptions = coreServerOptions.authService;
    }

    if(typeof coreServerOptions === 'object' && typeof coreServerOptions.requireAuthentication !== 'boolean') {
        var requireAuthentication = false;
    }
    else {
        var requireAuthentication = coreServerOptions.requireAuthentication;
    }

    DeviceJSCore.call(this, coreServerOptions);

    this.app = express();
    this.localApp = express();
    this.appRouter = express.Router();

    if(httpsOptions.server) {
        this.httpServer = https.createServer(httpsOptions.server, this.app);
    }
    else {
        this.httpServer = http.createServer(this.app);
    }

    if(!coreServerOptions.localPort) {
        coreServerOptions.localPort = DEFAULT_LOCAL_PORT
    }

    this.localHTTPServer = http.createServer(this.localApp);

    this.nodeID = coreServerOptions.nodeID || makeUUIDHex();
    this.socketIOServer = socketio(this.httpServer);
    this.localSocketIOServer = socketio(this.localHTTPServer);
    this.httpPort = httpPort;
    this.localPort = coreServerOptions.localPort;
    this.requestMap = { };
    this.peerConnectionMap = { };
    this.nextCommandID = 0;

    if(coreServerOptions.cloudAddress) {
        this.cloudTunnel = new CloudTunnel(coreServerOptions.cloudAddress, coreServerOptions)
        
        this.cloudTunnel.on('error', function(error) {
            coreLogger.error('Cloud tunnel error', error)
        }).on('addSubscription', function(subscription) {
            // subscription object looks like this
            //     {
            //         id: 'asdf',
            //         graph: {
            //             logic: { },
            //             sources: {
            //                 0: { node: 'id="hello"', parent: '4' }, 
            //                 1: { node: 'interface="BBB"', parent: '5' },
            //                 2: { node: 'type="k"', parent: '5' }
            //             }
            //         },
            //         event: 'eventname',
            //         prefix: true|false
            //     }
            coreLogger.info('Cloud subscription added', subscription)
            self.cloudSubscriberRegistry.subscribe(subscription.id, subscription.graph, subscription.event, subscription.prefix)
        }).on('removeSubscription', function(subscription) {
            coreLogger.info('Cloud subscription removed', subscription)
            self.cloudSubscriberRegistry.unsubscribe(subscription.id)
        }).on('disconnect', function() {
            coreLogger.info('Forgetting cloud subscriptions')
            self.cloudSubscriberRegistry.gc()
        })
    }

    this.cloudSubscriberRegistry = new CloudSubscriberRegistry(this._resourceIndex);
    this.deviceJSDiscoverer = discovery.createDeviceJSDiscoverer('mdns', this.nodeID, httpsOptions.server ? 'https' : 'http', this.httpPort, coreServerOptions.databaseConfig ? coreServerOptions.databaseConfig.port : 9000)
    this.moduleInstallDirectory = moduleInstallDirectory;
    this.shutdownPromises = null;
    this._ddb = ddb.createClient(coreServerOptions.databaseConfig);
    this.stateCache = new StateCache({ ddb: this._ddb })    
    this.resourceMonitor = new ResourceMonitor({ ddb: this._ddb, subscriberRegistry: new SubscriberRegistry(this._resourceIndex), stateCache: this.stateCache, getState: this.getState.bind(this), getGroups: this.getGroups.bind(this) })
    this.linkGraph = new LinkGraph({ ddb: this._ddb });
    this.authorizer = new WigWagAuthorizer({
        relayID: this.nodeID,
        relayPrivateKey: httpsOptions.client ? httpsOptions.client.key : '',
        relayPublicKey: httpsOptions.client ? httpsOptions.client.cert : '',
        ddb: this._ddb
    })

    this.deviceJSDiscoverer.on('discover', function(nodeID, protocol, address, port, databasePort) {
        var key = ROUTING_TABLE_PREFIX+'.'+ddb.encodeKey(nodeID)

        self.nodeMonitor.addPeer(nodeID, protocol + '://' + address + ':' + port)

        if(databasePort) {
            self._ddb.addPeer(protocol + '://' + address + ':' + databasePort)
        }

        self._ddb.local.get(key).then(function(result) {
            var context = '';

            if(result && !(result instanceof Error)) {
                context = result.context;
            }

            return self._ddb.local.put(ROUTING_TABLE_PREFIX+'.'+ddb.encodeKey(nodeID), JSON.stringify({ address: address, port: port, protocol: protocol }), context);
        });
    });

    // Authorization middleware for socket.io

    this.localSocketIOServer.use(function(socket, next) {
        var request = socket.request;
        var query = querystring.parse(url.parse(request.url).query);
        var encodedToken = query.encodedToken;

        self.authorizer.decodeAccessToken(encodedToken).then(function(decodedAccessToken) {
            socket.decodedToken = decodedAccessToken;
            next();
        }, function(error) {
            coreLogger.warn('Reject connection token=%s', encodedToken, error);
            next(error);
        });
    });

    this.socketIOServer.use(function(socket, next) {
        var request = socket.request;
        var query = querystring.parse(url.parse(request.url).query);
        var encodedToken = query.encodedToken;

        self.authorizer.decodeAccessToken(encodedToken).then(function(decodedAccessToken) {
            socket.decodedToken = decodedAccessToken;
            next();
        }, function(error) {
            coreLogger.warn('Reject connection token=%s', encodedToken, error);
            next(error);
        });
    });

    function publish(resourceID, type1, type2, event, data, dontForward) {
        if(event != 'register' && event != 'discovery') {
            self.resourceMonitor.notify(resourceID, type1+'-'+event, data)
        }
        
        self._subscriberRegistry.getSubscribers(resourceID, type1+'-'+event).then(function(peers) {
            Object.keys(peers).forEach(function(subscriberID) {
                var associationID = subscriberID.split('-')[0];
                var selectionID = subscriberID.split('-')[1];

                self.peerConnectionMap[associationID].socketPeer.emit(type2, resourceID, event, data, selectionID);
            });
        });

        if(!dontForward) {
            self.forwardingManager.forwardEvent([ 'cloud' ], {
                resourceID: resourceID,
                type1: type1,
                type2: type2,
                event: event,
                data: data
            })
            
            self._subscriberRegistry.getRemoteSubscribers(resourceID, type1+'-'+event).then(function(servers) {
                self.forwardingManager.forwardEvent(Object.keys(servers), {
                    resourceID: resourceID,
                    type1: type1,
                    type2: type2,
                    event: event,
                    data: data
                })
            });
        }
    }

    function cleanupConnections(associationID) {
        coreLogger.verbose('Cleanup connections (%s) connected=%s', associationID);
        self.handlePeerDisconnect(associationID);

        var promises = [ ];

        if(self.peerConnectionMap[associationID]) {
            var selectors = self.peerConnectionMap[associationID].selectors;

            try {
                Object.keys(selectors).forEach(function(selectionID) {
                    promises.push(self._subscriberRegistry.unsubscribeAll(associationID+'-'+selectionID).then(function() {

                    }, function(error) {
                        coreLogger.error('unsubscribeAll()', error)
                    }));

                    if(Array.isArray(self.shutdownPromises)) {
                        self.shutdownPromises.push(promises[promises.length-1]);
                    }
                });
            }
            catch(error) {
                coreLogger.error(error);
            }
        }

        delete self.peerConnectionMap[associationID];

        return Promise.all(promises);
    }

    this.localSocketIOServer.sockets.on('connection', function(socket) {
        var associationID = socket.decodedToken.associationID;

        self.handlePeerConnect(associationID);

        coreLogger.info('%s  connected', associationID);

        self.peerConnectionMap[associationID] = {
            socketPeer: socket,
            selectors: { }
        };

        socket.on('response', function(response) {
            var commandID = response.commandID;
            var resourceID = response.resourceID;
            var response = response.response;

            coreLogger.info('%s  respond  (resourceID=%s, commandID=%s, response=%s)', associationID, resourceID, commandID, JSON.stringify(response));

            if(self.requestMap[commandID]) {
                self.requestMap[commandID].response(resourceID, response);
                coreLogger.debug('200 responded to command %s', commandID);
            }
            else {
                coreLogger.warn('400 no such command %s', commandID);
            }
        })

        socket.on('disconnect', function() {
            coreLogger.info('%s  disconnected', associationID);
            cleanupConnections(associationID, socket);
        });

        socket.emit('ok');
    });

    this.socketIOServer.sockets.on('connection', function(socket) {
        var associationID = socket.decodedToken.associationID;

        self.handlePeerConnect(associationID);

        coreLogger.info('%s  connected', associationID);

        self.peerConnectionMap[associationID] = {
            socketPeer: socket,
            selectors: { }
        };

        socket.on('response', function(response) {
            var commandID = response.commandID;
            var resourceID = response.resourceID;
            var response = response.response;

            coreLogger.info('%s  respond  (resourceID=%s, commandID=%s, response=%s)', associationID, resourceID, commandID, JSON.stringify(response));

            if(self.requestMap[commandID]) {
                self.requestMap[commandID].response(resourceID, response);
                coreLogger.debug('200 responded to command %s', commandID);
            }
            else {
                coreLogger.warn('400 no such command %s', commandID);
            }
        })

        socket.on('disconnect', function() {
            coreLogger.info('%s  disconnected', associationID);
            cleanupConnections(associationID, socket);
        });

        socket.emit('ok');
    });

    function getAssociationID(req, res, next) {
        var authorizationHeader = req.headers.authorization;

        if(typeof authorizationHeader !== 'string') {
            res.status(401).send();
            return;
        }

        var encodedToken = authorizationHeader.substring('Bearer '.length);

        self.authorizer.decodeAccessToken(encodedToken).then(function(decodedAccessToken) {
            var associationID = decodedAccessToken.associationID;

            if(self.peerConnectionMap[associationID]) {
                req.associationID = associationID;
            }

            next();
        }, function(error) {
            res.status(401).send();
        });
    }

    function requireNotificationChannel(req, res, next) {
        if(req.associationID) {
            next();
        }
        else {
            res.status(500).send('No notification channel established');
        }
    }

    function readJSONFile(path) {
        return new Promise(function(resolve, reject) {
            fs.readFile(path, { encoding: 'utf8' }, function(error, data) {
                if(error) {
                    reject(error);
                }
                else {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch(error) {
                        reject(error);
                    }
                }
            });
        });
    }

    function listModuleStatuses() {
        var moduleInstallDirectory = self.moduleInstallDirectory;
        var moduleInstallPath = path.join(moduleInstallDirectory, 'installed');
        var moduleEnabledPath = path.join(moduleInstallDirectory, 'enabled');
        var moduleStatuses = { };
        var installedModuleNames;
        var enabledModuleNames;

        return new Promise(function(resolve, reject) {
            fs.readdir(moduleInstallPath, function(error, files) {
                if(error) {
                    reject(error);
                }
                else {
                    resolve(Promise.all(files.map(function(moduleName) {
                        return readJSONFile(path.join(moduleInstallPath, moduleName, 'devicejs.json')).then(function(moduleInfo) {
                            moduleStatuses[moduleName] = { version: moduleInfo.version, name: moduleName, enabled: false };
                        }, function(error) {
                        });
                    })));
                }
            });
        }).then(function() {
            return new Promise(function(resolve, reject) {
                fs.readdir(moduleEnabledPath, function(error, files) {
                    if(error) {
                        reject(error);
                    }
                    else {
                        files.forEach(function(moduleName) {
                            if(moduleStatuses[moduleName]) {
                                moduleStatuses[moduleName].enabled = true;
                            }
                        });

                        resolve(moduleStatuses);
                    }
                });
            });
        });
    }


    function checkSelectionString(selectionString) {
        try {
            selection.parse(selectionString);
            return selectionString;
        }
        catch(error) {
            // ignore error. return value will be null
            return null;
        }
    }

    function authorize(req, res, next) {
        isAuthorized(req).then(function(authorized) {
            if(authorized) {
                next();
            }
            else {
                res.status(401).send();
            }
        }, function(error) {
            console.error(error);
            res.status(500).send(error.stack);
        });
    }

    function getRelayMap() {
        return self._ddb.cloud.get('wigwag.relays').then(function(result) {
            if(result == null || result.siblings.length == 0) {
                return new Map()
            }

            let mergedParsedRelayMap = new Map()

            for(let sibling of result.siblings) {
                try {
                    let parsedRelayMap = JSON.parse(sibling)

                    for(let relayID in parsedRelayMap) {
                        mergedParsedRelayMap.set(relayID, parsedRelayMap[relayID])
                    }
                }
                catch(error) {
                }
            }

            return mergedParsedRelayMap
        })
    }

    function getUserCredentials(email) {
        return self._ddb.cloud.get('wigwag.users.' + email).then(function(result) {
            if(result == null || result.siblings.length == 0) {
                return null
            }

            try {
                return JSON.parse(result.siblings[0])
            }
            catch(error) {
                return null
            }
        })
    }

    function isAuthorized(req) {
        return new Promise(function(resolve, reject) {
            if(!coreServerOptions.requireAuthentication) {
                resolve(true);
                return;
            }

            // is this over SSL?
            if(req.socket.encrypted) {
                if(req.socket.authorized) {
                    // client provided a valid certificate to authenticate themselves
                    var clientID = req.socket.getPeerCertificate().subject.CN;

                    self.authorizer.isRelayAuthorized(clientID).then(function(isAuthorized) {
                        resolve(isAuthorized)
                    }, function(error) {
                        resolve(false)
                    });

                    return;
                }
            }

            if(req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
                var accessToken = req.headers.authorization.substring('Bearer '.length);

                self.authorizer.decodeAccessToken(accessToken).then(function(decodedAccessToken) {
                    resolve(true);
                }, function(error) {
                    resolve(false);
                })
            }
            else {
                resolve(false);
            }
        })
    }

    this.app.post('/token', bodyParser.json(), function(req, res) {
        var associationID = makeUUIDHex();

        if(!coreServerOptions.requireAuthentication) {
            self.authorizer.generateAccessTokenNoCredentials().then(function(accessToken) {
                res.status(200).send(accessToken);
            }, function(error) {
                res.status(500).send(error.message);
            });

            return;
        }

        var username = req.body.username;
        var password = req.body.password;

        self.authorizer.generateAccessToken(username, password).then(function(accessToken) {
            if(accessToken == null) {
                res.status(401).send();

                return;
            }

            res.status(200).send(accessToken);
        }, function(error) {
            coreLogger.warn('401 Unauthorized');

            res.status(401).send();
        });
    });

    this.localApp.post('/token', bodyParser.json(), function(req, res) {
        var username = req.body.username;
        var password = req.body.password;

        if(typeof username == 'string' && typeof password == 'string') {
            self.authorizer.generateAccessToken(username, password).then(function(accessToken) {
                if(accessToken == null) {
                    res.status(401).send();

                    return;
                }

                res.status(200).send(accessToken);
            }, function(error) {
                res.status(500).send(error.message);
            });
        }
        else {
            self.authorizer.generateAccessTokenNoCredentials().then(function(accessToken) {
                res.status(200).send(accessToken);
            }, function(error) {
                res.status(500).send(error.message);
            });
        }
    });

    this.app.get('/requiresAuth', function(req, res) {
        res.status(200).send(''+!!coreServerOptions.requireAuthentication);
    })

    this.localApp.get('/requiresAuth', function(req, res) {
        res.status(200).send('false');
    })

    this.app.use(authorize);
    this.app.use(this.appRouter);
    this.localApp.use(this.appRouter);

    this.appRouter.use(bodyParser.json());

    var nodeMonitorOptions = {
        https: httpsOptions.client,
        requireAuthentication: coreServerOptions.requireAuthentication
    };

    if(coreServerOptions.nodeMonitor) {
        for(var k in coreServerOptions.nodeMonitor) {
            nodeMonitorOptions[k] = coreServerOptions.nodeMonitor[k];
        }
    }

    var forwardingManagerOptions = {
        https: httpsOptions.client,
        requireAuthentication: coreServerOptions.requireAuthentication,
        getAddresses: this.getAddresses.bind(this)
    }

    this.forwardingManager = new ForwardingManager(this.nodeID, this.app, forwardingManagerOptions, this.cloudTunnel)
    this.nodeMonitor = new NodeMonitor(this.nodeID, this.app, nodeMonitorOptions, this.cloudTunnel)

    this.forwardingManager.on('event', function(nodeID, eventInfo) {
        var resourceID = eventInfo.resourceID
        var type1 = eventInfo.type1
        var type2 = eventInfo.type2
        var event = eventInfo.event
        var data = eventInfo.data

        coreLogger.info('%s forwardEvent  (resourceID=%s, type1=%s, type2=%s, event=%s, data=)', resourceID, type1, type2, event, data)

        publish(resourceID, type1, type2, event, data, true)
    }).on('request', function(forwarderID, requestInfo, resources, respond) {
        var requestCategory = requestInfo.requestCategory
        var selection = requestInfo.selection
        var command = requestInfo.command
        var originalCommandID = requestInfo.commandID
        var commandID = self.nextCommandID ++
        var senderID = requestInfo.senderID
        var selectionString = checkSelectionString(selection)
        var resourceIDs = resources

        coreLogger.info('%s forwardRequest  (selection=%s, requestCategory=%s, command=%s, commandID=%s)', forwarderID, selectionString, requestCategory, JSON.stringify(command), originalCommandID);

        if(selectionString == null) {
            coreLogger.warn('400 invalid selection %s', selectionString);
            respond(400, 'Invalid selection');
            return;
        }

        self.requestMap[commandID] = {
            requestCategory: requestCategory,
            command: command,
            responseSet: { },
            pendingResponseCount: 0,
            isReady: false,
            updateBatch: [ ],
            ready: function() {
                self.requestMap[commandID].isReady = true;

                if(self.requestMap[commandID].pendingResponseCount == 0) {
                    self.requestMap[commandID].finish();
                }
            },
            finish: function() {
                coreLogger.debug('200 finish request (commandID=%s)', commandID);
                respond(200, self.requestMap[commandID].responseSet);
                clearTimeout(self.requestMap[commandID].timeout);
                self.stateCache.update(self.requestMap[commandID].updateBatch);
                delete self.requestMap[commandID];
            },
            cancel: function(statusCode, message) {
                respond(statusCode, message);
                clearTimeout(self.requestMap[commandID].timeout);
                delete self.requestMap[commandID];
            },
            response: function(resourceID, response) {
                if(self.requestMap[commandID].responseSet[resourceID] &&
                   !self.requestMap[commandID].responseSet[resourceID].receivedResponse) {
                    self.requestMap[commandID].responseSet[resourceID].receivedResponse = true;
                    self.requestMap[commandID].responseSet[resourceID].response = response;

                    if(requestCategory == 'state get') {
                        if(command.property == '') {
                            // the response should be an object
                            if(typeof response.result === 'object' && response.result !== null) {
                                for(let property in response.result) {
                                    self.requestMap[commandID].updateBatch.push({
                                        op: 'set',
                                        resource: resourceID,
                                        property: property,
                                        value: response.result[property]
                                    })
                                }
                            }
                        }
                        else {
                            // the response should contain one property
                            if(typeof response.result !== null) {
                                self.requestMap[commandID].updateBatch.push({
                                    op: 'set',
                                    resource: resourceID,
                                    property: command.property,
                                    value: response.result
                                })
                            }
                        }
                    }

                    self.requestMap[commandID].pendingResponseCount -= 1;

                    if(self.requestMap[commandID].isReady && self.requestMap[commandID].pendingResponseCount == 0) {
                        self.requestMap[commandID].finish();
                    }
                }
            }
        };

        self.requestMap[commandID].timeout = setTimeout(function() {
            coreLogger.warn('request timed out %s', commandID);
            self.requestMap[commandID].finish();
        }, 10000);

        if(requestCategory != 'command' && requestCategory != 'state set' && requestCategory != 'state get') {
            coreLogger.warn('400 invalid request category');
            self.requestMap[commandID].cancel(400, 'Invalid request category');
            return;
        }

        var forwardingSet = [ ];
        var recipientMap = { };

        resourceIDs.forEach(function(resourceID) {
            var associationID = self.getResourceOwner(resourceID);

            if(associationID == null) {
                forwardingSet.push(resourceID);
            }
            else {
                recipientMap[associationID] = recipientMap[associationID] ||  { };
                recipientMap[associationID][resourceID] = true;
            }

            self.requestMap[commandID].responseSet[resourceID] = { receivedResponse: false, response: null };
            self.requestMap[commandID].pendingResponseCount += 1;
        });

        self.requestMap[commandID].ready();

        if(forwardingSet.length > 0) {
            var forwardingKeys = forwardingSet.map(resourceID => RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID));
            var nodeIDToResourceID = { };

            self._ddb.lww.get(forwardingKeys).then(function(results) {
                for(var i = 0; i < results.length; i += 1) {
                    var result = results[i];

                    if(result && !(result instanceof Error)) {
                        var nodeID = result.value;

                        if(nodeID !== self.nodeID) {
                            nodeIDToResourceID[nodeID] = nodeIDToResourceID[nodeID] || [ ];
                            nodeIDToResourceID[nodeID].push(forwardingSet[i]);
                        }
                        else {
                            self.requestMap[commandID].pendingResponseCount -= 1;

                            if(self.requestMap[commandID].pendingResponseCount == 0) {
                                self.requestMap[commandID].finish();
                            }
                        }
                    }
                    else {
                        self.requestMap[commandID].pendingResponseCount -= 1;

                        if(self.requestMap[commandID].pendingResponseCount == 0) {
                            self.requestMap[commandID].finish();
                        }
                    }
                }
            }, function(error) {
                // will receive no response for these
                coreLogger.warn('Unable to get resource owners from map', error);
            }).then(function() {
                if(Object.keys(nodeIDToResourceID).length > 0) {
                    self.forwardingManager.forwardRequests(nodeIDToResourceID, {
                        requestCategory: requestCategory,
                        selection: selectionString,
                        command: command,
                        commandID: commandID,
                        senderID: senderID
                    }).then(function(responseMap) {
                        for(var resourceID in responseMap) {
                            var responseInfo = responseMap[resourceID];

                            if(responseInfo.receivedResponse) {
                                if(self.requestMap[commandID]) {
                                    self.requestMap[commandID].response(resourceID, responseInfo.response);
                                }
                            }
                        }
                    });
                }
            })
        }

        for(var associationID in recipientMap) {
            var resourceSet = Object.keys(recipientMap[associationID]);

            if(requestCategory == 'command') {
                self.peerConnectionMap[associationID].socketPeer.emit('command', command.command, command.arguments, resourceSet, commandID, selectionString);
            }
            else if(requestCategory == 'state set') {
                self.peerConnectionMap[associationID].socketPeer.emit('state set', command.property, command.value, resourceSet, commandID, selectionString);
            }
            else if(requestCategory == 'state get') {
                self.peerConnectionMap[associationID].socketPeer.emit('state get', command.property, resourceSet, commandID, selectionString);
            }
        }
    })

    this.appRouter.get('/reachabilityMap', function(req, res) {
        res.status(200).send(self.nodeMonitor.getReachabilityMap());
    });

    this.appRouter.get('/nodeID', function(req, res) {
        res.status(200).send({ id: self.nodeID });
    });

    this.appRouter.use(getAssociationID);
    this.appRouter.use(function(req, res, next) {
        coreLogger.verbose('<%s> %s %s', req.associationID, req.method, req.originalUrl, req.body);
        next();
    });

    function mergeOwnerSets(ownerSets) {
        let mergedOwnerSet = { };

        for(var i = 0; i < ownerSets.length; i += 1) {
            let ownerSet = { };

            try {
                ownerSet = JSON.parse(ownerSets[i]);
            }
            catch(error) {

            }

            if(typeof ownerSet !== 'object' || ownerSet == null) {
                ownerSet = { };
            }

            for(var k in ownerSet) {
                mergedOwnerSet[k] = true;
            }
        }

        return mergedOwnerSet;
    }

    this.appRouter.post('/register', requireNotificationChannel, function(req, res) {
        // indicate that a certain peer is the controller
        // for the specified resource
        var resourceID = req.body.resourceID;
        var resourceType = req.body.resourceType;

        coreLogger.info('%s  register  (resourceID=%s, resourceType=%s)', req.associationID, resourceID, resourceType);

        if(typeof resourceID !== 'string' || resourceID.length == 0) {
            coreLogger.warn('400 resource id is invalid %s', resourceID);
            res.status(400).send('Invalid resource ID');
        }
        else {
            self.handleRegisterResource(req.associationID, resourceID, resourceType).then(function(resourceTypeDefinition) {
                var resourceOwnersSet = { };
                var context = '';

                return self._ddb.shared.get(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID)).then(function(result) {
                    if(result && !(result instanceof Error)) {
                        context = result.context;
                        resourceOwnersSet = mergeOwnerSets(result.siblings);
                    }
                }, function(error) {

                }).then(function() {
                    resourceOwnersSet[self.nodeID] = true;
                    return self._ddb.shared.put(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID), JSON.stringify(resourceOwnersSet), context)
                }).then(function() {
                    return resourceTypeDefinition;
                }, function(error) {
                    coreLogger.warn('Unable to place resource mapping in database', error);
                    return resourceTypeDefinition;
                });
            }).then(function(resourceTypeDefinition) {
                coreLogger.debug('200 registered %s to %s', resourceID, req.associationID);
                publish(resourceID, 'event', 'event', 'register', { definition: resourceTypeDefinition });
                publish(resourceID, 'event', 'event', 'discovery', { definition: resourceTypeDefinition });
                res.status(200).send({ 'ok': true });
            }, function(error) {
                if(error.message.match(/^Invalid resource type/)) {
                    coreLogger.warn('400 resource type is invalid %s', resourceType);
                    res.status(400).send('Invalid resource type');
                }
                else if(error.message.match(/^Already registered/)) {
                    coreLogger.warn('500 resource is already registered %s', resourceID);
                    res.status(500).send('Already registered');
                }
                else if(error.message.match(/^Peer disconnected/)) {
                    coreLogger.warn('500 peer disconnected');
                    res.status(500).send('Peer disconnected');
                }
                else {
                    coreLogger.error('500 an internal server error occurred', error);
                    res.status(500).send('A database error occurred');
                }
            });
        }
    });

    this.appRouter.post('/unregister', requireNotificationChannel, function(req, res) {
        // indicate that a certain peer is no longer the
        // controller for the specified resource
        var resourceID = req.body.resourceID;

        coreLogger.info('%s  unregister  (resourceID=%s)', req.associationID, resourceID);

        if(typeof resourceID !== 'string' || resourceID.length == 0) {
            coreLogger.warn('400 resource ID is invalid %s', resourceID);
            res.status(400).send('Invalid resource ID');
        }
        else {
            self.handleUnregisterResource(req.associationID, resourceID).then(function(resourceTypeDefinition) {
                let resourceOwnersSet = { };
                let context = '';

                return self._ddb.shared.get(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID)).then(function(result) {
                    if(result && !(result instanceof Error)) {
                        context = result.context;
                        resourceOwnersSet = mergeOwnerSets(result.siblings);
                    }
                }, function(error) {

                }).then(function() {
                    delete resourceOwnersSet[self.nodeID];
                    return self._ddb.shared.put(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID), JSON.stringify(resourceOwnersSet), context)
                }).then(function() {
                    return resourceTypeDefinition;
                }, function(error) {
                    coreLogger.warn('Unable to delete the resource mapping from the database', error);
                    return resourceTypeDefinition;
                });
            }).then(function(resourceTypeDefinition) {
                coreLogger.debug('200 unregistered %s from %s', resourceID, req.associationID);
                publish(resourceID, 'event', 'event', 'unregister', { definition: resourceTypeDefinition });
                res.status(200).send({ 'ok': true });
            }, function(error) {
                if(error.message.match(/^No such resource/)) {
                    coreLogger.warn('404 resource does not exist %s', resourceID);
                    res.status(404).send('No such resource');
                }
                else if(error.message.match(/^Peer does not own this resource/)) {
                    coreLogger.warn('403 %s does not own this resource %s', req.associationID, resourceID);
                    res.status(403).send('Peer does not own this resource');
                }
                else {
                    coreLogger.error('500 An internal server error occurred', error);
                    res.status(500).send('a database error occurred');
                }
            });
        }
    });

    this.appRouter.post('/forget', requireNotificationChannel, function(req, res) {
        // indicate that a certain peer is no longer the
        // controller for the specified resource
        var resourceID = req.body.resourceID;

        coreLogger.info('%s  forget  (resourceID=%s)', resourceID);

        if(typeof resourceID !== 'string' || resourceID.length == 0) {
            coreLogger.warn('400 resource ID is invalid %s', resourceID);
            res.status(400).send('Invalid resource ID');
        }
        else {
            return Promise.all([
                self.linkGraph.update([ { op: 'unlinkAll', node: resourceID } ]),
                self.stateCache.update([ { op: 'delete', resource: resourceID } ]),
                self.forgetResource(resourceID)
            ]).then(function() {
                coreLogger.debug('200 forgot resource %s from', resourceID);
                res.status(200).send({ 'ok': true });
            }, function(error) {
                if(error.message.match(/^No such resource/)) {
                    coreLogger.warn('404 resource does not exist %s', resourceID);
                    res.status(404).send('No such resource');
                }
                else {
                    coreLogger.error('500 An internal server error occurred', error);
                    res.status(500).send('a database error occurred');
                }
            });
        }
    });

    this.appRouter.post('/subscribe', requireNotificationChannel, function(req, res) {
        // subscribe peer to some resource event (state change, resource event)
        var selection = req.body.selection;
        var eventCategory = req.body.eventCategory;        // event/state
        var eventType = req.body.eventType;                // state property, event name
        var selectionID = req.body.selectionID;
        var selectionString = checkSelectionString(selection);

        coreLogger.info('%s  subscribe  (selection=%s, eventCategory=%s, eventType=%s, selectionID=%s)', req.associationID, selectionString, eventCategory, eventType, selectionID);

        if(selectionString == null) {
            coreLogger.warn('400 invalid selection %s', selectionString);
            res.status(400).send('Invalid selection');
            return;
        }

        var subscribePromise = Promise.resolve()

        if(eventCategory == 'event') {
            if(eventType == '+') {
                // subscribe to all event types
                subscribePromise = self._subscriberRegistry.subscribeAll(req.associationID+'-'+selectionID, selectionString, eventCategory+'-');
            }
            else {
                subscribePromise = self._subscriberRegistry.subscribe(req.associationID+'-'+selectionID, selectionString, eventCategory+'-'+eventType);
            }

            subscribePromise.then(function(subscriptionID) {
                self.peerConnectionMap[req.associationID].selectors[selectionID] = self.peerConnectionMap[req.associationID].selectors[selectionID] || { };
                self.peerConnectionMap[req.associationID].selectors[selectionID][subscriptionID] = true;

                coreLogger.debug('200 subscribed %s to events (%s, %s) where %s', req.associationID, eventCategory, eventType, selectionString);
                res.status(200).send({ 'ok': true, id: subscriptionID });
            }, function(error) {
                coreLogger.error('500 a database error occurred', error);
                res.status(500).send('A database error occurred');
            });
        }
        else if(eventCategory == 'state') {
            if(eventType == '+') {
                // subscribe to all event types
                subscribePromise = self._subscriberRegistry.subscribeAll(req.associationID+'-'+selectionID, selectionString, eventCategory+'-');
            }
            else {
                subscribePromise = self._subscriberRegistry.subscribe(req.associationID+'-'+selectionID, selectionString, eventCategory+'-'+eventType);
            }

            subscribePromise.then(function(subscriptionID) {
                self.peerConnectionMap[req.associationID].selectors[selectionID] = self.peerConnectionMap[req.associationID].selectors[selectionID] || { };
                self.peerConnectionMap[req.associationID].selectors[selectionID][subscriptionID] = true;

                coreLogger.debug('200 subscribed %s to states (%s, %s) where %s', req.associationID, eventCategory, eventType, selectionString);
                res.status(200).send({ 'ok': true, id: subscriptionID });
            }, function(error) {
                coreLogger.error('500 a database error occurred', error);
                res.status(500).send('A database error occurred');
            });
        }
        else {
            coreLogger.warn('400 event category is invalid %s', eventCategory);
            res.status(400).send('Invalid event category');
        }
    });

    this.appRouter.post('/unsubscribe', requireNotificationChannel, function(req, res) {
        // unsubscribe peer to some resource event (state change, resource event)
        var selectionID = req.body.selectionID;
        var id = req.body.id;

        coreLogger.info('%s  unsubscribe  (selectionID=%s, id=%s)', req.associationID, selectionID, id);

        if(self.peerConnectionMap[req.associationID].selectors[selectionID]) {
            delete self.peerConnectionMap[req.associationID].selectors[selectionID][id];
        }
    
        let p
        
        if(!id) {
            p = self._subscriberRegistry.unsubscribeAll(req.associationID+'-'+selectionID)
        }
        else {
            p = self._subscriberRegistry.unsubscribe(req.associationID+'-'+selectionID, id)
        }

        p.then(function() {
            coreLogger.debug('200 unsubscribed %s from %s %s', req.associationID, selectionID, id);
            res.status(200).send({ 'ok': true });
        }, function(error) {
            coreLogger.error('500 a database error occurred', error);
            res.status(500).send('A database error occurred');
        });
    });

    this.appRouter.post('/publish', requireNotificationChannel, function(req, res) {
        // publish some resource event (state change, resource event)
        var resourceID = req.body.resourceID;
        var eventCategory = req.body.eventCategory;
        var eventType = req.body.eventType;
        var eventData = req.body.eventData;

        coreLogger.info('%s  publish  (resourceID=%s, eventCategory=%s, eventType=%s, eventData=%s)', req.associationID, resourceID, eventCategory, eventType, JSON.stringify(eventData));

        if(eventCategory == 'event') {
            coreLogger.debug('200 %s event %s', resourceID, eventType, eventData);

            if(eventType == 'reachable') {
                // mark resource as reachable
                self.markResourceReachable(resourceID, true)
            }
            else if(eventType == 'unreachable') {
                // mark resource as unreachable
                self.markResourceReachable(resourceID, false)
            }

            publish(resourceID, 'event', 'event', eventType, eventData);
            res.status(200).send({ 'ok': true });
        }
        else if(eventCategory == 'state') {
            coreLogger.debug('200 %s state change %s', resourceID, eventType, eventData);

            self.stateCache.update([
                { op: 'set', resource: resourceID, property: eventType, value: eventData }
            ])

            publish(resourceID, 'state', 'state change', eventType, eventData);
            res.status(200).send({ 'ok': true });
        }
        else {
            coreLogger.warn('400 event category is invalid %s', eventCategory);
            res.status(400).send('Invalid event category');
        }
    });

    this.appRouter.post('/createGroup', requireNotificationChannel, function(req, res) {
        // create a resource group
        var groupName = req.body.groupName;

        coreLogger.info('%s  createGroup  (groupName=%s)', req.associationID, groupName);

        self.handleCreateResourceGroup(req.associationID, groupName).then(function() {
            coreLogger.debug('200 %s create group %s', req.associationID, groupName);
            res.status(200).send({ 'ok': true });
        }, function(error) {
            if(error.message.match(/Invalid resource group name/)) {
                coreLogger.warn('400 resource group name is invalid %s', groupName);
                res.status(400).send('Invalid resource group name');
            }
            else {
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    this.appRouter.post('/deleteGroup', requireNotificationChannel, function(req, res) {
        // delete a resource group
        var groupName = req.body.groupName;

        coreLogger.info('%s  deleteGroup  (groupName=%s)', req.associationID, groupName);

        self.handleDeleteResourceGroup(req.associationID, groupName).then(function() {
            coreLogger.debug('200 %s delete group %s', req.associationID, groupName);
            res.status(200).send({ 'ok': true });
        }, function(error) {
            if(error.message.match(/Invalid resource group name/)) {
                coreLogger.warn('400 resource group name is invalid %s', groupName);
                res.status(400).send('Invalid resource group name');
            }
            else {
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    this.appRouter.post('/addToGroup', requireNotificationChannel, function(req, res) {
        // add a resource to a resource group
        var resourceID = req.body.resourceID;
        var groupName = req.body.groupName;

        coreLogger.info('%s  addToGroup  (resourceID=%s, groupName=%s)', req.associationID, resourceID, groupName);

        self.handleJoinResourceGroup(req.associationID, resourceID, groupName).then(function() {
            coreLogger.debug('200 %s add resource %s to group %s', req.associationID, resourceID, groupName);
            self.getResourceTypeDefinition(resourceID).then(function(resourceTypeDefinition) {
                publish(resourceID, 'event', 'event', 'discovery', { definition: resourceTypeDefinition });
            })

            res.status(200).send({ 'ok': true });
        }, function(error) {
            if(error.message.match(/Invalid resource group name/)) {
                coreLogger.warn('400 resource group name is invalid %s', groupName);
                res.status(400).send('Invalid resource group name');
            }
            else if(error.message.match(/No such resource/)) {
                coreLogger.warn('404 resource does not exist %s', resourceID);
                res.status(404).send('No such resource');
            }
            else {
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        })

    });

    this.appRouter.post('/removeFromGroup', requireNotificationChannel, function(req, res) {
        // remove a resource from a resource group
        var resourceID = req.body.resourceID;
        var groupName = req.body.groupName;

        coreLogger.info('%s  removeFromGroup  (resourceID=%s, groupName=%s)', req.associationID, resourceID, groupName);

        self.handleLeaveResourceGroup(req.associationID, resourceID, groupName).then(function() {
            coreLogger.debug('200 %s remove resource %s from group %s', req.associationID, resourceID, groupName);
            res.status(200).send({ 'ok': true });
        }, function(error) {
            if(error.message.match(/Invalid resource group name/)) {
                coreLogger.warn('400 resource group name is invalid %s', groupName);
                res.status(400).send('Invalid resource group name');
            }
            else {
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    function removeThisNodeFromResourceOwners(resourceID) {
        return self._ddb.shared.get(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID)).then(function(result) {
            if(result && !(result instanceof Error)) {
                let context = result.context;
                let resourceOwnersSet = mergeOwnerSets(result.siblings);
                delete resourceOwnersSet[self.nodeID];
                return self._ddb.shared.put(RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID), JSON.stringify(resourceOwnersSet), context)
            }
        }).then(function() {
        }, function(error) {
        });
    }

    this.appRouter.post('/request', requireNotificationChannel, function(req, res) {
        var requestCategory = req.body.requestCategory;
        var selection = req.body.selection;
        var command = req.body.command;
        var commandID = self.nextCommandID ++;
        var senderID = self._devicejsPeerMap[req.associationID].uuid;
        var selectionString = checkSelectionString(selection);

        coreLogger.info('%s  request  (selection=%s, requestCategory=%s, command=%s, commandID=%s)', req.associationID, selectionString, requestCategory, JSON.stringify(command), commandID);

        if(selectionString == null) {
            coreLogger.warn('400 invalid selection %s', selectionString);
            res.status(400).send('Invalid selection');
            return;
        }

        self.requestMap[commandID] = {
            requestCategory: requestCategory,
            command: command,
            responseSet: { },
            req: req,
            res: res,
            pendingResponseCount: 0,
            isReady: false,
            updateBatch: [ ],
            ready: function() {
                self.requestMap[commandID].isReady = true;

                if(self.requestMap[commandID].pendingResponseCount == 0) {
                    self.requestMap[commandID].finish();
                }
            },
            finish: function() {
                coreLogger.debug('200 finish request (commandID=%s)', commandID);
                res.status(200).send(self.requestMap[commandID].responseSet);
                clearTimeout(self.requestMap[commandID].timeout);
                self.stateCache.update(self.requestMap[commandID].updateBatch);
                delete self.requestMap[commandID];
            },
            cancel: function(statusCode, message) {
                res.status(statusCode).send(message);
                clearTimeout(self.requestMap[commandID].timeout);
                delete self.requestMap[commandID];
            },
            response: function(resourceID, response) {
                if(self.requestMap[commandID].responseSet[resourceID] &&
                   !self.requestMap[commandID].responseSet[resourceID].receivedResponse) {
                    self.requestMap[commandID].responseSet[resourceID].receivedResponse = true;
                    self.requestMap[commandID].responseSet[resourceID].response = response;

                    if(requestCategory == 'state get') {
                        if(command.property == '') {
                            // the response should be an object
                            if(typeof response.result === 'object' && response.result !== null) {
                                for(let property in response.result) {
                                    self.requestMap[commandID].updateBatch.push({
                                        op: 'set',
                                        resource: resourceID,
                                        property: property,
                                        value: response.result[property]
                                    })
                                }
                            }
                        }
                        else {
                            // the response should contain one property
                            if(typeof response.result !== null) {
                                self.requestMap[commandID].updateBatch.push({
                                    op: 'set',
                                    resource: resourceID,
                                    property: command.property,
                                    value: response.result
                                })
                            }
                        }
                    }

                    self.requestMap[commandID].pendingResponseCount -= 1;

                    if(self.requestMap[commandID].isReady && self.requestMap[commandID].pendingResponseCount == 0) {
                        self.requestMap[commandID].finish();
                    }
                }
            }
        };

        self.requestMap[commandID].timeout = setTimeout(function() {
            coreLogger.warn('request timed out %s', commandID);
            self.requestMap[commandID].finish();
        }, 10000);

        if(requestCategory != 'command' && requestCategory != 'state set' && requestCategory != 'state get') {
            coreLogger.warn('400 invalid request category');
            self.requestMap[commandID].cancel(400, 'Invalid request category');
            return;
        }

        var forwardingSet = [ ];
        var otherIsReady = false

        var forwardingPromise = self.getSelection(selectionString, false, true).then(function(selectionSet) {
            if(Object.keys(selectionSet).length > 0) {
                self.requestMap[commandID].pendingResponseCount += Object.keys(selectionSet).length;

                Object.keys(selectionSet).forEach(function(resourceID) {
                    if(self.requestMap[commandID].responseSet[resourceID]) {
                        self.requestMap[commandID].pendingResponseCount -= 1;
                    }
                    else {
                        self.requestMap[commandID].responseSet[resourceID] = { receivedResponse: false, response: null };
                        forwardingSet.push(resourceID)
                    }
                });
            }

            if(otherIsReady) {
                self.requestMap[commandID].ready();
            }
            
            otherIsReady = true

            if(forwardingSet.length > 0) {
                var forwardingKeys = forwardingSet.map(resourceID => RESOURCE_OWNER_PREFIX+'.'+ddb.encodeKey(resourceID));
                var nodeIDToResourceID = { };

                return self._ddb.shared.get(forwardingKeys).then(function(results) {
                    for(var i = 0; i < results.length; i += 1) {
                        var result = results[i];

                        if(result && !(result instanceof Error)) {
                            var nodeIDs = mergeOwnerSets(result.siblings);
                            var nodeID = null;
                            console.log('NODE IDS', nodeIDs)

                            if(nodeIDs[self.nodeID] && self.getResourceOwner(forwardingSet[i])) {
                                nodeID = self.nodeID;
                            }
                            else {
                                if(nodeIDs[self.nodeID]) {
                                    removeThisNodeFromResourceOwners(forwardingSet[i])
                                    delete nodeIDs[self.nodeID]
                                }

                                for(var n in nodeIDs) {
                                    if(self.nodeMonitor.isReachable(n)) {
                                        nodeID = n;
                                    }
                                }
                            }

                            console.log('node id', nodeID)

                            if(nodeID !== null) {
                                if(nodeID !== self.nodeID) {
                                    nodeIDToResourceID[nodeID] = nodeIDToResourceID[nodeID] || [ ];
                                    nodeIDToResourceID[nodeID].push(forwardingSet[i]);
                                }
                                else {
                                    delete self.requestMap[commandID].responseSet[forwardingSet[i]];
                                    self.requestMap[commandID].pendingResponseCount -= 1;

                                    if(self.requestMap[commandID].pendingResponseCount == 0) {
                                        self.requestMap[commandID].finish();
                                    }
                                }
                            }
                        }
                    }
                }, function(error) {
                    // will receive no response for these
                    coreLogger.warn('Unable to get resource owners from map', error);
                    // TODO mark all as not received response
                }).then(function() {
                    if(Object.keys(nodeIDToResourceID).length > 0) {
                        self.forwardingManager.forwardRequests(nodeIDToResourceID, {
                            requestCategory: requestCategory,
                            selection: selectionString,
                            command: command,
                            commandID: commandID,
                            senderID: senderID
                        }).then(function(responseMap) {
                            console.log('resolve it now', responseMap)
                            for(var resourceID in responseMap) {
                                var responseInfo = responseMap[resourceID];

                                self.requestMap[commandID].response(resourceID, responseInfo);
                            }
                        });
                    }
                });
            }
        });

        var emittingPromise = self.getSelection(selectionString, true, false).then(function(selectionSet) {
            if(Object.keys(selectionSet).length > 0) {
                self.requestMap[commandID].pendingResponseCount += Object.keys(selectionSet).length;

                Object.keys(selectionSet).forEach(function(resourceID) {
                    self.requestMap[commandID].responseSet[resourceID] = { receivedResponse: false, response: null };
                });
            }

            if(otherIsReady) {
                self.requestMap[commandID].ready();
            }
            
            otherIsReady = true;
            
            return selectionSet;
        }).then(function(selectionSet) {
            var resourceIDs = Object.keys(selectionSet);
            var recipientMap = { };


            resourceIDs.forEach(function(resourceID) {
                var associationID = self.getResourceOwner(resourceID);

                if(associationID != null) {
                    recipientMap[associationID] = recipientMap[associationID] || { };
                    recipientMap[associationID][resourceID] = true;
                }
            });

            for(var associationID in recipientMap) {
                var resourceSet = Object.keys(recipientMap[associationID]);

                if(requestCategory == 'command') {
                    self.peerConnectionMap[associationID].socketPeer.emit('command', command.command, command.arguments, resourceSet, commandID, selectionString);
                }
                else if(requestCategory == 'state set') {
                    self.peerConnectionMap[associationID].socketPeer.emit('state set', command.property, command.value, resourceSet, commandID, selectionString);
                }
                else if(requestCategory == 'state get') {
                    self.peerConnectionMap[associationID].socketPeer.emit('state get', command.property, resourceSet, commandID, selectionString);
                }
            }
        })

        Promise.all([
            forwardingPromise,
            emittingPromise
        ]).then(function() {
        }, function(error) {
            coreLogger.error('500 an internal server error occurred', error);
            self.requestMap[commandID].cancel(500, 'A database error occurred');
        });
    });

    this.appRouter.post('/list', requireNotificationChannel, function(req, res) {
        var selection = req.body.selection;
        var selectionString = checkSelectionString(selection);

        coreLogger.info('%s  list  (selection=%s)', req.associationID, selectionString);

        if(selectionString == null) {
            coreLogger.warn('400 invalid selection %s', selectionString);
            res.status(400).send('Invalid selection');
            return;
        }

        self.getSelection(selectionString).then(function(selectionSet) {
            coreLogger.debug('200 list ok %s', selectionString);
            res.status(200).send(selectionSet);
        }, function(error) {
            coreLogger.error('500 an internal server error occurred', error);
            res.status(500).send();
        });
    });

    this.appRouter.get('/group', function(req, res) {
        var group = req.query.group;

        coreLogger.info('%s  group  (groupName=%s)', req.associationID, group);

        self.getGroupHierarchy(group).then(function(groupHierarchy) {
            coreLogger.debug('200 group ok %s', group);
            res.status(200).send(groupHierarchy);
        }, function(error) {
            if(/No such group/.test(error.message)) {
                if(typeof group === 'undefined' || typeof group === 'string' && group.length == 0) {
                    coreLogger.debug('200 group ok %s', group);
                    res.status(200).send({ resources: { }, children: { } });
                }
                else {
                    coreLogger.warn('404 no such group %s', group);
                    res.status(404).send('No such group');
                }
            }
            else {
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    this.appRouter.post('/addInterfaceType', function(req, res) {
        var schema = req.body.schema;

        self.addInterfaceType(schema).then(function() {
            coreLogger.info('%s  addInterfaceType  (name=%s, version=%s)', req.associationID, schema.name, schema.version);
            coreLogger.debug('200 addInterfaceType ok');
            res.status(200).send();
        }, function(error) {
            if(error.message.match(/^Validation Error/)) {
                coreLogger.info('%s  addInterfaceType  (name=undefined, version=undefined)', req.associationID);
                coreLogger.warn('400 invalid interface schema');
                res.status(400).send(error.message);
            }
            else{
                coreLogger.info('%s  addInterfaceType  (name=%s, version=%s)', req.associationID, schema.name, schema.version);
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    this.appRouter.get('/interfaceTypes', function(req, res) {
        coreLogger.info('%s  interfaceTypes', req.associationID);

        self.listInterfaceTypes().then(function(interfaceTypes) {
            coreLogger.debug('200 interfaceTypes ok');
            res.status(200).send(interfaceTypes);
        }, function(error) {
            coreLogger.error('500 an internal server error occurred', error);
            res.status(500).send();
        });
    });

    this.appRouter.get('/interfaceType/:interfaceTypeName/:interfaceTypeVersion', function(req, res) {
        var interfaceTypeName = req.params.interfaceTypeName;
        var interfaceTypeVersion = req.params.interfaceTypeVersion;

        self.listInterfaceTypes().then(function(interfaceTypes) {
            if(interfaceTypes[interfaceTypeName] && interfaceTypes[interfaceTypeName][interfaceTypeVersion]) {
                res.status(200).send(interfaceTypes[interfaceTypeName][interfaceTypeVersion]);
            }
            else {
                res.status(404).send();
            }
        }, function(error) {
            res.status(500).send();
        });
    });

    this.appRouter.post('/addResourceType', function(req, res) {
        var schema = req.body.schema;

        self.addResourceType(req.body.schema).then(function() {
            coreLogger.info('%s  addResourceType  (name=%s, version=%s)', req.associationID, schema.name, schema.version);
            coreLogger.debug('200 addResourceType ok');
            res.status(200).send();
        }, function(error) {
            if(error.message.match(/^Validation Error/)) {
                coreLogger.info('%s  addResourceType  (name=undefined, version=undefined)', req.associationID);
                coreLogger.warn('400 invalid resource schema');
                res.status(400).send(error.message);
            }
            else{
                coreLogger.info('%s  addResourceType  (name=%s, version=%s)', req.associationID, schema.name, schema.version);
                coreLogger.error('500 an internal server error occurred', error);
                res.status(500).send('A database error occurred');
            }
        });
    });

    this.appRouter.get('/resourceTypes', function(req, res) {
        coreLogger.info('%s  resourceTypes', req.associationID);

        self.listResourceTypes().then(function(resourceTypes) {
            coreLogger.debug('200 resourceTypes ok');
            res.status(200).send(resourceTypes);
        }, function(error) {
            coreLogger.error('500 an internal server error occurred', error);
            res.status(500).send();
        });
    });

    this.appRouter.get('/resourceType/:resourceTypeName/:resourceTypeVersion', function(req, res) {
        var resourceTypeName = req.params.resourceTypeName;
        var resourceTypeVersion = req.params.resourceTypeVersion;

        self.listResourceTypes().then(function(resourceTypes) {
            if(resourceTypes[resourceTypeName] && resourceTypes[resourceTypeName][resourceTypeVersion]) {
                res.status(200).send(resourceTypes[resourceTypeName][resourceTypeVersion]);
            }
            else {
                res.status(404).send();
            }
        }, function(error) {
            res.status(500).send();
        });
    });

    this.appRouter.post('/graphUpdates', function(req, res) {
        if(!Array.isArray(req.body)) {
            coreLogger.warn('POST /graphUpdates invalid request body');
            
            res.status(400).send()

            return
        }

        for(let update of req.body) {
            if(!validate(update, GraphUpdateSchema).valid) {
                coreLogger.warn('POST /graphUpdates invalid update: ', update);   
                
                res.status(400).send()

                return
            }
        }

        self.linkGraph.update(req.body).then(() => {
            res.status(200).send()
        }, (error) => {
            coreLogger.error('POST /graphUpdates error: ', error);
            
            res.status(500).send()
        })
    });

    this.appRouter.get('/graph', function(req, res) {
        let nodes = [ ]

        if(typeof req.query.node === 'string') {
            nodes = [ req.query.node ]
        }
        else if(Array.isArray(req.query.node)) {
            nodes = req.query.node
        }

        if(nodes.length == 0) {
            res.status(200).send([ ])

            return
        }

        self.linkGraph.edges(nodes).then((edges) => {
            res.status(200).send(edges)
        }, (error) => {
            coreLogger.error('GET /graph error: ', error);
            
            res.status(500).send()
        })
    });

    this.appRouter.get('/versions', function(req, res) {
        var deviceJSVersion = require('../../package.json').version;

        coreLogger.info('%s  versions', req.associationID);

        listModuleStatuses().then(function(moduleStatuses) {
            var moduleVersions = { };

            Object.keys(moduleStatuses).forEach(function(moduleName) {
                moduleVersions[moduleName] = moduleStatuses[moduleName].version;
            });

            coreLogger.debug('200 versions ok');
            res.status(200).send({
                devicejs: deviceJSVersion,
                modules: moduleVersions
            });
        }, function(error) {
            coreLogger.warn('unable to list module statuses', error);
            coreLogger.debug('200 versions ok');
            res.status(200).send({
                devicejs: deviceJSVersion,
                modules: { }
            });
        });
    });

    this.appRouter.get('/modules', function(req, res) {
        coreLogger.info('%s  modules', req.associationID);

        listModuleStatuses().then(function(moduleStatuses) {
            coreLogger.debug('200 modules ok');
            res.status(200).send(moduleStatuses);
        }, function(error) {
            coreLogger.warn('unable to list module statuses', error);
            coreLogger.debug('200 modules ok');
            res.status(200).send({ });
        });
    });
};

HTTPCoreServer.prototype = Object.create(DeviceJSCore.prototype);

HTTPCoreServer.prototype._newRequestOptions = function(options) {
    var newOptions = { };

    if(this.httpsOptions.client) {
        for(var k in this.httpsOptions.client) {
            newOptions[k] = this.httpsOptions.client;
        }
    }

    for(var k in options) {
        newOptions[k] = options[k];
    }

    return newOptions;
};

HTTPCoreServer.prototype.getGroups = function(resourceID) {
    return this._resourceIndex.getResourceProperties(resourceID).then((properties) => {
        return Promise.resolve(consolidateGroups(Object.keys(properties.groups) || [ ]))
    })
};

function consolidateGroups(groups) {
    groups = groups.map(g => g + '/')
    groups.sort()

    groups = groups.filter((g, i, groups) => {
        if(i == groups.length - 1) {
            return true
        }

        return !groups[i + 1].startsWith(g)
    })

    groups = groups.map(g => g.substring(0, g.length - 1))

    return groups
}

HTTPCoreServer.prototype.getState = function(sel, property) {
    function checkSelectionString(selectionString) {
        try {
            selection.parse(selectionString);
            return selectionString;
        }
        catch(error) {
            // ignore error. return value will be null
            return null;
        }
    }

    var self = this;
    var requestCategory = 'state get';
    var command = { property: property };
    var commandID = self.nextCommandID ++;
    var senderID = '0'
    var selectionString = checkSelectionString(sel);

    coreLogger.info('getState (selection=%s, requestCategory=%s, command=%s, commandID=%s)', selectionString, requestCategory, JSON.stringify(command), commandID);

    if(selectionString == null) {
        coreLogger.warn('invalid selection %s', selectionString);
        return Promise.reject(new Error('Invalid selection'))
    }

    let promise = { }
    let result = new Promise((resolve, reject) => {
        promise.resolve = resolve
        promise.reject = reject
    })

    self.requestMap[commandID] = {
        requestCategory: requestCategory,
        command: command,
        responseSet: { },
        pendingResponseCount: 0,
        isReady: false,
        ready: function() {
            self.requestMap[commandID].isReady = true;

            if(self.requestMap[commandID].pendingResponseCount == 0) {
                self.requestMap[commandID].finish();
            }
        },
        finish: function() {
            coreLogger.debug('finish getState (commandID=%s)', commandID);
            promise.resolve(self.requestMap[commandID].responseSet);
            clearTimeout(self.requestMap[commandID].timeout);
            delete self.requestMap[commandID];
        },
        cancel: function(statusCode, message) {
            promise.reject(new Error('Request canceled: ' + message));
            clearTimeout(self.requestMap[commandID].timeout);
            delete self.requestMap[commandID];
        },
        response: function(resourceID, response) {
            if(self.requestMap[commandID].responseSet[resourceID] &&
                !self.requestMap[commandID].responseSet[resourceID].receivedResponse) {
                self.requestMap[commandID].responseSet[resourceID].receivedResponse = true;
                self.requestMap[commandID].responseSet[resourceID].response = response;

                self.requestMap[commandID].pendingResponseCount -= 1;

                if(self.requestMap[commandID].isReady && self.requestMap[commandID].pendingResponseCount == 0) {
                    self.requestMap[commandID].finish();
                }
            }
        }
    };

    self.requestMap[commandID].timeout = setTimeout(function() {
        coreLogger.warn('getState timed out %s', commandID);
        self.requestMap[commandID].finish();
    }, 10000);

    var emittingPromise = self.getSelection(selectionString, true, false).then(function(selectionSet) {
        if(Object.keys(selectionSet).length > 0) {
            self.requestMap[commandID].pendingResponseCount += Object.keys(selectionSet).length;

            Object.keys(selectionSet).forEach(function(resourceID) {
                self.requestMap[commandID].responseSet[resourceID] = { receivedResponse: false, response: null };
            });
        }

        self.requestMap[commandID].ready();
        
        return selectionSet;
    }).then(function(selectionSet) {
        var resourceIDs = Object.keys(selectionSet);
        var recipientMap = { };


        resourceIDs.forEach(function(resourceID) {
            var associationID = self.getResourceOwner(resourceID);

            if(associationID != null) {
                recipientMap[associationID] = recipientMap[associationID] || { };
                recipientMap[associationID][resourceID] = true;
            }
        });

        for(var associationID in recipientMap) {
            var resourceSet = Object.keys(recipientMap[associationID]);

            if(requestCategory == 'command') {
                self.peerConnectionMap[associationID].socketPeer.emit('command', command.command, command.arguments, resourceSet, commandID, selectionString);
            }
            else if(requestCategory == 'state set') {
                self.peerConnectionMap[associationID].socketPeer.emit('state set', command.property, command.value, resourceSet, commandID, selectionString);
            }
            else if(requestCategory == 'state get') {
                self.peerConnectionMap[associationID].socketPeer.emit('state get', command.property, resourceSet, commandID, selectionString);
            }
        }
    })

    Promise.all([
        emittingPromise
    ]).then(function() {
    }, function(error) {
        coreLogger.error('getState an internal server error occurred', error);
        promise.reject(error)
    });

    return result
};

HTTPCoreServer.prototype.getAddresses = function(nodeIDs) {
    function getAddress(result) {
        if(result == null || (result instanceof Error)) {
            return null
        }

        let siblings = result.siblings

        if(siblings.length > 0) {
            try {
                var address = JSON.parse(siblings[0])

                if(address === null || typeof address !== 'object') {
                    return null
                }
                else {
                    return address
                }
            }
            catch(error) {
                return null
            }
        }
        else {
            return null
        }
    }

    let keys = nodeIDs.map(nodeID => ROUTING_TABLE_PREFIX+'.'+ddb.encodeKey(nodeID))

    return this._ddb.local.get(keys).then(function(results) {
        return results.map(r => getAddress(r))
    })
};

HTTPCoreServer.prototype.start = function() {
    var self = this;

    this.nodeMonitor.start()
    this.resourceMonitor.start()

    return DeviceJSCore.prototype.start.call(this).then(function() {
        return new Promise(function(resolve, reject) {
            self.httpServer.listen(self.httpPort, function(error) {
                if(error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }).then(function() {
        return new Promise(function(resolve, reject) {
            self.localHTTPServer.listen(self.localPort, '127.0.0.1', function(error) {
                if(error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }).then(function() {
        //self.deviceJSDiscoverer.start()
    }).then(function() {
        if(self.cloudTunnel) {
            self.cloudTunnel.start()
        }
    });
};

HTTPCoreServer.prototype.stop = function() {
    var self = this;

    this.shutdownPromises = [ ];

    this.nodeMonitor.stop()
    this.resourceMonitor.stop()

    //this.deviceJSDiscoverer.stop()

    if(this.cloudTunnel) {
        this.cloudTunnel.stop()
    }

    return Promise.all(Object.keys(self.peerConnectionMap).map(function(associationID) {
        return new Promise(function(resolve, reject) {
            var socket = self.peerConnectionMap[associationID].socketPeer;

            socket.once('disconnect', function() {
                resolve();
            });

            socket.disconnect();

            //cleanupConnections(socket.decodedToken.associationID);

            delete self.peerConnectionMap[associationID];
        });
    })).then(function() {
        return Promise.all(self.shutdownPromises).then(function() {
            self.shutdownPromises = null;
        }, function(error) {
            self.shutdownPromises = null;
        });
    }).then(function() {
        return DeviceJSCore.prototype.stop.call(self)
    }).then(function() {
        return new Promise(function(resolve, reject) {
            self.httpServer.close(function(error) {
                if(error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }).then(function() {
        return new Promise(function(resolve, reject) {
            self.localHTTPServer.close(function(error) {
                if(error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    });
};

module.exports = {
    DeviceJSCore: HTTPCoreServer
};
