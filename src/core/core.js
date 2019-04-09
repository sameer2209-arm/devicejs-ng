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

// resource scope: who is it available to?
//     Local ->  talk to only things connected to the same router
//     Global -> talk to all things

// Core extends Router
// 
var path = require('path');
var validate = require('jsonschema').validate;
var uuid = require('node-uuid');
var EventEmitter = require('events').EventEmitter;
var devicedb = require('../runtime/devicedb');
var ddb = devicedb({ });
var registry = require('./registry');
var SubscriberRegistry = require('./ddbSubscriberRegistry');
var ResourceIndex = require('./ddbResourceIndex');
var ResourceGroupTree = require('./resourceGroupTree');
var ReachabilityMap = require('./ddbReachabilityMap');
var util = require('util');
var coreLogger = require('./logging')('core');
var selectionLib = require('./selection');
var LRU = require('lru-cache');

var SEMANTIC_VERSION_REGEX = '^([0]|([1-9]([0-9]*)?))\.([0]|([1-9]([0-9]*)?))\.([0]|([1-9]([0-9]*)?))$';
var NON_EMPTY_STRING_REGEX = '^.+$';
var RESOURCE_TYPES_PREFIX = 'devicejs.core.resourceTypes';
var INTERFACES_PREFIX = 'devicejs.core.interfaces';

var interfaceDefinitionSchema = {
    "type": "object",
    "properties": {
        "name": { "type": "string", "pattern": NON_EMPTY_STRING_REGEX },
        "version": { "type": "string", "pattern": SEMANTIC_VERSION_REGEX },
        "commands": { 
            "type": "object",
            "patternProperties": {
                ".+": {
                    "type": "object",
                    "properties": {
                        "arguments": { "type": "array", "items": { "type": "object" } },
                        "returns": { "type": "object" }
                    },
                    "required": [ "arguments", "returns" ]
                }
            },
            "additionalProperties": false
        },
        "state": {
            "type": "object",
            "patternProperties": {
                ".+": {
                    "type": "object",
                    "properties": {
                        "readOnly": { "type": "boolean" },
                        "schema": { "type": "object" }
                    },
                    "required": [ "readOnly", "schema" ]
                }
            },
            "additionalProperties": false
        },
        "events": {
            "type": "object",
            "patternProperties": {
                ".+": {
                    "type": "object",
                    "properties": {
                        "schema": { "type": "object" }
                    },
                    "required": [ "schema" ]
                }
            },
            "additionalProperties": false
        }
    },
    "required": [ "name", "version", "commands", "state", "events" ]
};

var resourceTypeDefinitionSchema = {
    "type": "object",
    "properties": {
        "name": { "type": "string", "pattern": NON_EMPTY_STRING_REGEX },
        "version": { "type": "string", "pattern": SEMANTIC_VERSION_REGEX },
        "interfaces": { "type": "array", "items": { "type": "string", "pattern": NON_EMPTY_STRING_REGEX } }
    },
    "required": [ "name", "version", "interfaces" ]
};

var DEFAULT_CACHE_SIZE = 1000;
var DEFAULT_CACHE_TTL = 60*1000*10;

var DeviceJSCore = function(options) {
    EventEmitter.call(this);

    // know when peers connect
    // remember, resource connections need to be multiplexed
    // over peer connections
    this._ddb = ddb.createClient(options.databaseConfig);
    this._devicejsPeerMap = { };
    this._resourceMap = { };
    this._resourceGroupTree = new ResourceGroupTree(this._ddb);
    this._resourceIndex = new ResourceIndex(this._ddb, this._resourceGroupTree);
    this._resourceRegistry = new registry.ResourceRegistry(this._resourceIndex);
    this._subscriberRegistry = new SubscriberRegistry(options.nodeID, this._ddb, this._resourceIndex);
    this._reachabilityMap = new ReachabilityMap(options.nodeID, this._ddb);
    this._resourceCache = LRU({ max: DEFAULT_CACHE_SIZE, maxAge: DEFAULT_CACHE_TTL });
};

DeviceJSCore.prototype = Object.create(EventEmitter.prototype);

DeviceJSCore.prototype.start = function() {
    var self = this;

    this._devicejsPeerMap = { };
    this._resourceMap = { };
    this._resourceCache.reset();
    this._resourceIndex.clearCache();

    return Promise.resolve().then(function() {
        return self._reachabilityMap.clear();
    });
};

DeviceJSCore.prototype.stop = function() {
    return Promise.resolve();
};

DeviceJSCore.prototype.addResourceType = function(resourceTypeDefinition) {
    var validateResult = validate(resourceTypeDefinition, resourceTypeDefinitionSchema);
    var self = this;

    if(validateResult.valid) {
        var key = RESOURCE_TYPES_PREFIX+'.' +
            ddb.encodeKey(resourceTypeDefinition.name)+'.'+
            ddb.encodeKey(resourceTypeDefinition.version);
        
        return this._ddb.lww.get(key).then(function(value) {
            return self._ddb.lww.put(key, JSON.stringify(resourceTypeDefinition), value ? value.context : '');
        }).then(function() {
            coreLogger.verbose('addResourceType(%s) -> return', JSON.stringify(resourceTypeDefinition));
        }, function(error) {
            coreLogger.verbose('addResourceType(%s) -> error', JSON.stringify(resourceTypeDefinition), error);
            throw error;
        });
    }
    else {
        var rejectErrorMessage = 'Validation Error: \n';

        validateResult.errors.forEach(function(error) {
            rejectErrorMessage += error.property + ' ' + error.message + '\n';
        });

        coreLogger.verbose('addResourceType(%s) -> error', JSON.stringify(resourceTypeDefinition), new Error(rejectErrorMessage));

        return Promise.reject(new Error(rejectErrorMessage));
    }
};

DeviceJSCore.prototype.addInterfaceType = function(interfaceDefinition) {
    var validateResult = validate(interfaceDefinition, interfaceDefinitionSchema);
    var self = this;

    if(validateResult.valid) {
        var key = INTERFACES_PREFIX+'.' +
            ddb.encodeKey(interfaceDefinition.name)+'.'+
            ddb.encodeKey(interfaceDefinition.version);
        
        return this._ddb.lww.get(key).then(function(value) {
            return self._ddb.lww.put(key, JSON.stringify(interfaceDefinition), value ? value.context : '');
        }).then(function() {
            coreLogger.verbose('addInterfaceType(%s) -> return', JSON.stringify(interfaceDefinition));
        }, function(error) {
            coreLogger.verbose('addInterfaceType(%s) -> error', JSON.stringify(interfaceDefinition), error);
            throw error;
        });
    }
    else {
        var rejectErrorMessage = 'Validation Error: \n';

        validateResult.errors.forEach(function(error) {
            rejectErrorMessage += error.property + ' ' + error.message + '\n';
        });

        coreLogger.verbose('addInterfaceType(%s) -> error', JSON.stringify(interfaceDefinition), new Error(rejectErrorMessage));

        return Promise.reject(new Error(rejectErrorMessage));
    }
};

DeviceJSCore.prototype.listResourceTypes = function() {
    var resourceTypes = { };
    
    coreLogger.verbose('listResourceTypes()');
    
    function next(error, result) {
        var parts = result.key.substring(result.prefix.length).split('.');
        var resourceTypeName = ddb.decodeKey(parts[0]);
        var resourceTypeVersion = ddb.decodeKey(parts[1]);
        var resourceType = resourceTypes[resourceTypeName] = resourceTypes[resourceTypeName] || { };
        
        resourceType[resourceTypeVersion] = JSON.parse(result.value);
    }
    
    return this._ddb.lww.getMatches(RESOURCE_TYPES_PREFIX+'.', next).then(function() {
        coreLogger.verbose('listResourceTypes() -> return', resourceTypes);
        
        return resourceTypes;
    }, function(error) {
        coreLogger.verbose('listResourceTypes() -> warn', error);
        coreLogger.verbose('listResourceTypes() -> return', { });
        return { };
    });
};

DeviceJSCore.prototype.listInterfaceTypes = function() {
    var interfaceTypes = { };
    
    coreLogger.verbose('listInterfaceTypes()');
    
    function next(error, result) {
        var parts = result.key.substring(result.prefix.length).split('.');
        var interfaceTypeName = ddb.decodeKey(parts[0]);
        var interfaceTypeVersion = ddb.decodeKey(parts[1]);
        var interfaceType = interfaceTypes[interfaceTypeName] = interfaceTypes[interfaceTypeName] || { };
        
        interfaceType[interfaceTypeVersion] = JSON.parse(result.value);
    }
    
    return this._ddb.lww.getMatches(INTERFACES_PREFIX+'.', next).then(function() {
        coreLogger.verbose('listInterfaceTypes() -> return', interfaceTypes);
        
        return interfaceTypes;
    }, function(error) {
        coreLogger.verbose('listInterfaceTypes() -> warn', error);
        coreLogger.verbose('listInterfaceTypes() -> return', { });
        return { };
    });
};

DeviceJSCore.prototype.handlePeerConnect = function(peerID) {
    var uuidBuffer = new Buffer(16);
    uuid.v4(null, uuidBuffer, 0);
    var uuidHexString = uuidBuffer.toString('hex');
    this._devicejsPeerMap[peerID] = { uuid: uuidHexString, resources: { } };
    coreLogger.verbose('handlePeerConnect(%s) -> return', peerID);
};

DeviceJSCore.prototype.handlePeerDisconnect = function(peerID) {
    // need to do any related cleanup with resources and such here
    var unregisterPromises = Object.keys(this._devicejsPeerMap[peerID].resources).map(function(resourceID) {
        return this.handleUnregisterResource(peerID, resourceID);
    }.bind(this))
    
    // it is essential that this happens synchronously with this function call. if it does not it can cause
    // unexpected behaviour when clients disconnect then reconnect quickly
    delete this._devicejsPeerMap[peerID];
    
    Promise.all(unregisterPromises).then(function() {
        coreLogger.verbose('handlePeerDisconnect(%s) -> return', peerID);
    }.bind(this), function(error) {
        coreLogger.verbose('handlePeerDisconnect(%s) -> warn', peerID, error);
    }.bind(this));
};

DeviceJSCore.prototype.getResourceTypeDefinition = function(resourceID) {
    return new Promise(function(resolve, reject) {
        var resourceTypeName = this._resourceMap[resourceID].type;
        var resourceTypeDefinition = null;
    
        function next(error, result) {
            resourceTypeDefinition = JSON.parse(result.value);
        }
        
        return this._ddb.lww.getMatches(RESOURCE_TYPES_PREFIX+'.'+ddb.encodeKey(resourceTypeName), next).then(function() {
            resolve(resourceTypeDefinition);
        });

    }.bind(this));
};

DeviceJSCore.prototype.getSelection = function(selection, reachableOnly, unreachableOnly) {
    var selectionSet = { };
    var self = this;

    if(reachableOnly && /^(\s*)id(\s*)=(\s*)\"[^\"]*\"\s*$/.test(selection)) {
        var parsedSelection = selectionLib.parse(selection)

        if(parsedSelection instanceof selectionLib.StringCheckNode) {
            var resourceID = parsedSelection.getPropertyValue()

            if(self._resourceMap.hasOwnProperty(resourceID)) {
                selectionSet[resourceID] = { type: self._resourceMap[resourceID].type, registered: true, reachable: self._resourceMap[resourceID].reachable }

                return Promise.resolve(selectionSet)
            }
        }
    }
    
    return self._resourceRegistry.getSelection(selection).then(function(selection) {
        if(reachableOnly) {
            Object.keys(selection).forEach(function(resourceID) {
                if(self._resourceMap.hasOwnProperty(resourceID)) {
                    selectionSet[resourceID] = { type: self._resourceMap[resourceID].type, registered: true, reachable: self._resourceMap[resourceID].reachable }
                }
            })
            
            return selectionSet
        }
        else {
            var uncached = [ ]
            
            Object.keys(selection).forEach(function(resourceID) {
                var cached = self._resourceCache.get(resourceID);
                
                if(self._resourceMap.hasOwnProperty(resourceID)) {
                    if(!unreachableOnly) {
                        selectionSet[resourceID] = { type: self._resourceMap[resourceID].type, registered: true, reachable: self._resourceMap[resourceID].reachable }
                    }
                }
                else if(cached) {
                    selectionSet[resourceID] = { type: cached.resourceTypeName, registered: false, reachable: false }
                }
                else {
                    uncached.push(resourceID)
                }
            })
            
            var uncachedPromise = Promise.resolve([ ])
        
            if(uncached.length > 0) {
                uncachedPromise = self._ddb.lww.get(uncached.map(function(resourceID) {
                    return 'devicejs.core.resources.' + ddb.encodeKey(resourceID)
                }))
            }
            
            return uncachedPromise.then(function(resources) {
                resources = resources.map(r => r == null ? r : JSON.parse(r.value))

                uncached.forEach(function(resourceID, index) {
                    var resourceInfo = resources[index]
                    
                    if(!resourceInfo) {
                        selectionSet[resourceID] = { type: null };
                    }
                    else {
                        self._resourceCache.set(resourceID, resourceInfo)
                        
                        selectionSet[resourceID] = { type: resourceInfo.resourceTypeName };
                    }
                    
                    selectionSet[resourceID].registered = self._resourceMap.hasOwnProperty(resourceID);
                        
                    if(selectionSet[resourceID].registered) {
                        selectionSet[resourceID].reachable = self._resourceMap[resourceID].reachable;
                    }
                    else {
                        selectionSet[resourceID].reachable = false;
                    }
                })
                
                return selectionSet;
            })
        }
    }).then(function(result) {
        return result
    }, function(error) {
        if(/No such key/.test(error.value)) {
            coreLogger.verbose('getSelection(%s, %s) -> warn', selection, reachableOnly?'true':'false', error);
            coreLogger.verbose('getSelection(%s, %s) -> return', selection, reachableOnly?'true':'false', { });

            return { };
        }
        else {
            coreLogger.verbose('getSelection(%s, %s) -> error', selection, reachableOnly?'true':'false', error);
            throw error;
        }
    });
};

DeviceJSCore.prototype.getResourceOwner = function(resourceID) {
    if(this._resourceMap[resourceID]) {
        coreLogger.verbose('getResourceOwner(%s) -> return', resourceID, this._resourceMap[resourceID].peerID);
        return this._resourceMap[resourceID].peerID;
    }
    else {
        coreLogger.verbose('getResourceOwner(%s) -> return null', resourceID);
        return null;
    }
};

DeviceJSCore.prototype.markResourceReachable = function(resourceID, reachable) {
    if(this._resourceMap[resourceID]) {
        this._resourceMap[resourceID].reachable = !!reachable;

        if(reachable) {
            this._reachabilityMap.markAsReachable(resourceID);
        }
        else {
            this._reachabilityMap.markAsUnreachable(resourceID);
        }
    }
};

DeviceJSCore.prototype.handleRegisterResource = function(peerID, resourceID, resourceTypeName) {
    var resourceTypeDefinition = null;
 
    function next(error, result) {
        resourceTypeDefinition = JSON.parse(result.value);
    }
    
    return this._ddb.lww.getMatches(RESOURCE_TYPES_PREFIX+'.'+ddb.encodeKey(resourceTypeName), next).then(function() {
        if(resourceTypeDefinition == null) {
            throw new Error();
        }
        else {
            return resourceTypeDefinition;
        }
    }, function(error) {
        throw error;
    }).then(function(resourceTypeDefinition) {
        return resourceTypeDefinition;
    }, function(error) {
        throw new Error('Invalid resource type: ' + resourceTypeName);
    }).then(function(r) {
        resourceTypeDefinition = r;
        var key = 'devicejs.core.resources.'+ddb.encodeKey(resourceID);
        
        return this._ddb.lww.get(key).then(function(result) {
            return this._ddb.lww.put(key, JSON.stringify({
                resourceTypeName: resourceTypeName
            }), result ? result.context : '');
        }.bind(this));
    }.bind(this)).then(function() {
        if(this._resourceMap[resourceID]) {
            // return this.handleUnregisterResource(this._resourceMap[resourceID].peerID, resourceID);
            coreLogger.verbose('handleRegisterResource(%s, %s, %s) -> error', peerID, resourceID, resourceTypeName, new Error('Already registered'));
            throw new Error('Already registered');
        }
    }.bind(this)).then(function() {
        return this._resourceIndex.addResource({
            id: resourceID,
            type: resourceTypeName,
            interfaces: JSON.parse(JSON.stringify(resourceTypeDefinition.interfaces))
        });
    }.bind(this)).then(function() {
        if(!this._devicejsPeerMap[peerID]) {
            throw new Error('Peer disconnected');
        }
        
        // peer resouce ownership data is transient for now. the peer is tied to a connection
        // if that connection disappears then the mappings are reset
        this._devicejsPeerMap[peerID].resources[resourceID] = { type: resourceTypeName };
        this._devicejsPeerMap[peerID].resources[resourceID] = { type: resourceTypeName };
        this._resourceMap[resourceID] = { type: resourceTypeName, peerID: peerID, reachable: true };

        this._reachabilityMap.markAsReachable(resourceID);

        coreLogger.verbose('handleRegisterResource(%s, %s, %s) -> return', peerID, resourceID, resourceTypeName, resourceTypeDefinition);
        return resourceTypeDefinition;
    }.bind(this)).then(function(result) {
        return result;
    }, function(error) {
        coreLogger.verbose('handleRegisterResource(%s, %s, %s) -> error', peerID, resourceID, resourceTypeName, error);
        throw error;
    });
};

DeviceJSCore.prototype.handleUnregisterResource = function(peerID, resourceID) {
    var resourceTypeDefinition;

    if(!this._resourceMap[resourceID]) {
        return Promise.reject(new Error('No such resource'));
    }
    else if(this._resourceMap[resourceID].peerID != peerID) {
        return Promise.reject(new Error('Peer does not own this resource'));
    }
    
    this._resourceCache.del(resourceID);
    delete this._devicejsPeerMap[peerID].resources[resourceID];
    this._reachabilityMap.markAsUnreachable(resourceID);

    // it is essential that these two functions happen in this order so that the resource
    // is defined when getResourceTypeDefinition is called but the resource is deleted synchronously
    // with this function call
    return Promise.all([
        this.getResourceTypeDefinition(resourceID),
        (function() { delete this._resourceMap[resourceID]; return Promise.resolve() }.bind(this))()
    ]).then(function(results) {
        resourceTypeDefinition = results[0];
    }.bind(this)).then(function() {
        coreLogger.verbose('handleUnregisterResource(%s, %s) -> return', peerID, resourceID, resourceTypeDefinition);
        
        return resourceTypeDefinition;
    }.bind(this), function(error) {
        coreLogger.verbose('handleUnregisterResource(%s, %s) -> error', peerID, resourceID, error);
        
        throw error;
    });
};

DeviceJSCore.prototype.forgetResource = function(resourceID) {
    this._resourceCache.del(resourceID);
    
    return Promise.all([
        this._resourceIndex.removeResource(resourceID),
        this._ddb.delete('devicejs.core.resources.'+ddb.encodeKey(resourceID))
    ]);
};

DeviceJSCore.prototype.getGroupHierarchy = function(selection) {
    if(typeof selection == 'string' && selection.length > 0) {
        return this._resourceGroupTree.getGroup(selection).then(function(result) {
            coreLogger.verbose('getGroupHierarchy(%s) -> return', selection, result);
            return result;
        }, function(error) {
            coreLogger.verbose('getGroupHierarchy(%s) -> error', selection, error);
            throw error;
        });
    }
    else {
        return this._resourceGroupTree.getGroup().then(function(result) {
            coreLogger.verbose('getGroupHierarchy(%s) -> return', selection, result);
            return result;
        }, function(error) {
            coreLogger.verbose('getGroupHierarchy(%s) -> error', selection, error);
            throw error;
        });
    }
};

var RESOURCE_GROUP_REGEX = /^[^\/]+((\/[^\/]+)+)?$/;

DeviceJSCore.prototype.handleCreateResourceGroup = function(peerID, resourceGroup) {
    // persistance create group
    if(typeof resourceGroup !== 'string' || !RESOURCE_GROUP_REGEX.exec(resourceGroup)) {
        return Promise.reject(new Error('Invalid resource group name'));
    }

    return this._resourceIndex.createGroup(resourceGroup).then(function() {
        coreLogger.verbose('handleCreateResourceGroup(%s, %s) -> return', peerID, resourceGroup);
    }, function(error) {
        coreLogger.verbose('handleCreateResourceGroup(%s, %s) -> error', peerID, resourceGroup, error);
        throw error;
    });
};

DeviceJSCore.prototype.handleDeleteResourceGroup = function(peerID, resourceGroup) {
    if(typeof resourceGroup !== 'string' || !RESOURCE_GROUP_REGEX.exec(resourceGroup)) {
        return Promise.reject(new Error('Invalid resource group name'));
    }

    return this._resourceIndex.deleteGroup(resourceGroup).then(function() {
        coreLogger.verbose('handleDeleteResourceGroup(%s, %s) -> return', peerID, resourceGroup);
    }, function(error) {
        coreLogger.verbose('handleDeleteResourceGroup(%s, %s) -> error', peerID, resourceGroup, error);
        throw error;
    });
};

DeviceJSCore.prototype.handleJoinResourceGroup = function(peerID, resourceID, resourceGroup) {
    // persistance put resource info in group
    if(typeof resourceGroup !== 'string' || !RESOURCE_GROUP_REGEX.exec(resourceGroup)) {
        return Promise.reject(new Error('Invalid resource group name'));
    }

    return this._resourceIndex.getResources('id', resourceID).then((resources) => {
        if(resources[resourceID]) {
            return this._resourceIndex.joinGroup(resourceID, resourceGroup)
        }
        else {
            throw new Error('No such resource')
        }
    }).then(function() {
        coreLogger.verbose('handleJoinResourceGroup(%s, %s, %s) -> return', peerID, resourceID, resourceGroup);
    }, function(error) {
        coreLogger.verbose('handleJoinResourceGroup(%s, %s, %s) -> error', peerID, resourceID, resourceGroup, error);
        throw error;
    });
};

DeviceJSCore.prototype.handleLeaveResourceGroup = function(peerID, resourceID, resourceGroup) {
    if(typeof resourceGroup !== 'string' || !RESOURCE_GROUP_REGEX.exec(resourceGroup)) {
        return Promise.reject(new Error('Invalid resource group name'));
    }

    return this._resourceIndex.leaveGroup(resourceID, resourceGroup).then(function() {
        coreLogger.verbose('handleLeaveResourceGroup(%s, %s, %s) -> return', peerID, resourceID, resourceGroup);
    }, function(error) {
        coreLogger.verbose('handleLeaveResourceGroup(%s, %s, %s) -> error', peerID, resourceID, resourceGroup, error);
        throw error;
    });
};

module.exports = {
    DeviceJSCore: DeviceJSCore
};
