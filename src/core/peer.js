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

var EventEmitter = require('events').EventEmitter;
var uuid = require('node-uuid');
var selections = require('./selection');

function makeUUIDHex() {
    var uuidBuffer = new Buffer(16);

    uuid.v4(null, uuidBuffer, 0);

    return uuidBuffer.toString('hex');
}

function toProperty(p) {
    if(p == '+') {
        return '*';
    }
    else {
        return JSON.stringify(p);
    }
}

var SubscriptionSet = function() {
    this.subscriptions = { };
};

SubscriptionSet.prototype.add = function(selection, event, selectionID, subscriptionID, type) {
    this.subscriptions[subscriptionID] = { selection: selection, event: event, selectionID: selectionID, type: type }
};

SubscriptionSet.prototype.remove = function(subscriptionID) {
    delete this.subscriptions[subscriptionID]
};

SubscriptionSet.prototype.removeAll = function(selectionID) {
    for(var subscriptionID in this.subscriptions) {
        if(this.subscriptions[subscriptionID].selectionID == selectionID) {
            this.remove(subscriptionID);
        }
    }
};

SubscriptionSet.prototype.list = function() {
    var self = this;
    var selections = [ ];

    Object.keys(this.subscriptions).forEach(function(subscriptionID) {
        selections.push(self.subscriptions[subscriptionID])
    })

    return selections;
};

SubscriptionSet.prototype.clear = function() {
    this.subscriptions = { };
};

/**
 * A DeviceJS peer
 *
 * @class DeviceJSPeer
 * @constructor
 * @param {String} serverAddress The IP of the DeviceJS server
 * @param {Object} peerOptions The configuration options for this peer
 */
var HTTPPeer = function(serverAddress) {
    var self = this;
    EventEmitter.call(this);

    this.serverAddress = serverAddress;
    this.registeredResources = { };
    this.subscriptions = new SubscriptionSet();
    this.nextSelectionID = 1;
    this.selections = { };


    // A helper function that emits an event from this HTTP peer
    // object from an event name and an argument list
    function emit(eventName, argumentList) {
        var args = [ ];

        args.push(eventName);

        for(var i=0;i<argumentList.length;i++) {
            args.push(argumentList[i]);
        }

        self.emit.apply(self, args);
    }

    this.connectionEmitter = new EventEmitter();
    self.connectionEmitter.on('connect', function() {
        Object.keys(self.registeredResources).forEach(function(resourceID) {
            var resourceTypeName = self.registeredResources[resourceID];
            self.registerResource(resourceID, resourceTypeName);
        });

        var oldSubscriptions = self.subscriptions.list()

        self.subscriptions.clear()

        oldSubscriptions.forEach(function(s) {
            if(s.type == 'event') {
                self.subscribeToResourceEvent(s.selection, s.event, s.selectionID);
            }
            else {
                self.subscribeToResourceState(s.selection, s.event, s.selectionID);
            }
        });

        self.emit('connect');
    }).on('error', function(error) {
        try {
            self.emit('error', error);
        }
        catch(e) {
        }
    }).on('disconnect', function() {
        self.emit('disconnect');
    }).on('command', function() {    // All event handlers below this point are message
        emit('command', arguments);  // types specific to DeviceJS
    }).on('state set', function() {
        emit('state set', arguments);
    }).on('state get', function() {
        emit('state get', arguments);
    }).on('state change', function() {
        emit('state change', arguments);
    }).on('event', function() {
        emit('event', arguments);
    });
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

HTTPPeer.prototype = Object.create(EventEmitter.prototype);

/**
 * Connect to the DeviceJS server and set up peer
 *
 * @method connect
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 */
HTTPPeer.prototype.connect = function() {
    throw new Error('Not implemented');
};

/**
 * Disconnect from the DeviceJS server. This object will
 * emit no further events. connect must be called again in order
 * to make requests to the server.
 *
 * @method disconnect
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 */
HTTPPeer.prototype.disconnect = function() {
    throw new Error('Not implemented');
};

// A helper function that sends JSON encoded POST requests
// to the DeviceJS server
HTTPPeer.prototype.sendHTTPPost = function(path, body) {
    throw new Error('Not implemented');
};

// A helper function that sends JSON encoded GET requests
// to the DeviceJS server
HTTPPeer.prototype.sendHTTPGet = function(path) {
    throw new Error('Not implemented');
};

HTTPPeer.prototype.sendSocket = function(type, message) {
    throw new Error('Not implemented');
};

/**
 * Returns the URL of the server that this peer is connected
 * to
 *
 * @method getServerAddress
 * @return {String} The server address
 * @example
 * ```
 * let url = dev$.getServerAddress()
 * ```
 */
HTTPPeer.prototype.getServerAddress = function() {
    return this.serverAddress;
};

HTTPPeer.prototype.parseSelection = function(selection) {
    return selections.parse(selection);
};

/**
 * Add a new resource schema type to the DeviceJS server
 *
 * @method addResourceType
 * @param {Object} schema This is a resource type schema object
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 * @example
 * ```
 * dev$.addInterfaceType({
 *     name: 'MyInterfaceType', // name is a string that is longer than 0 characters
 *     version: '0.0.1',        // version is a semantic version string
 *     commands: {              // commands is an object whose property names are non-empty strings
 *         myCommand1: {
 *             arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
 *             returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
 *         }
 *     },
 *     state: {
 *         myStateProperty1: {
 *             readOnly: true,   // readOnly is a boolean value
 *             schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
 *         }
 *     },
 *     events: {
 *         myEventType: {
 *             schema: { type: 'string' }
 *         }
 *     }
 * }).then(function() {
 *      return dev$.addResourceType({
 *          name: 'MyResourceType',
 *          version: '0.0.1',
 *          interfaces: [ 'MyInterfaceType' ]
 *      });
 * }).then(function() {
 *     // Now MyResourceType is known by the system along with
 *     // its associated interfaces
 * });
 * ```
 */
HTTPPeer.prototype.addResourceType = function(schema) {
    return this.sendHTTPPost('/addResourceType', {
        schema: schema
    });
};

/**
 * Add a new interface schema type to the DeviceJS server
 *
 * @method addInterfaceType
 * @param {Object} schema This is an interface type schema object
 * @return {Promise} The success handler accepts no parameter. The failure
 *  handler accepts a single error object.
 * @example
 * ```
 * dev$.addInterfaceType({
 *     name: 'MyInterfaceType', // name is a string that is longer than 0 characters
 *     version: '0.0.1',        // version is a semantic version string
 *     commands: {              // commands is an object whose property names are non-empty strings
 *         myCommand1: {
 *             arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
 *             returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
 *         }
 *     },
 *     state: {
 *         myStateProperty1: {
 *             readOnly: true,   // readOnly is a boolean value
 *             schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
 *         }
 *     },
 *     events: {
 *         myEventType: {
 *             schema: { type: 'string' }
 *         }
 *     }
 * }).then(function() {
 *     // Now MyInterfaceType is known by the system and can be
 *     // used resource schemas added with addResourceType
 * })
 * ```
 */
HTTPPeer.prototype.addInterfaceType = function(schema) {
    return this.sendHTTPPost('/addInterfaceType', {
        schema: schema
    });
};

/**
 * Lists all the resource type schemas
 *
 * @method listResourceTypes
 * @return {Promise} Upon success, the promise resolves to an object
 *   that contains information on all known resource types:
 *
 *   {
 *       "ResourceType1": {
 *           "0.0.1": [ResourceTypeSchema],
 *           "0.0.2": [ResourceTypeSchema],
             ...
 *       },
 *       ...
 *   }
 *
 * @example
 * ```
 * return dev$.addResourceType({
 *     name: 'MyResourceType1',
 *     version: '0.0.1',
 *     interfaces: [ 'MyInterfaceType1' ]
 * }).then(function() {
 *     return dev$.addResourceType({
 *         name: 'MyResourceType2',
 *         version: '0.0.1',
 *         interfaces: [ 'MyInterfaceType1', 'MyInterfaceType2' ]
 *     });
 * }).then(function() {
       return dev$.listResourceTypes();
 * }).then(function(resourceTypes) {
 *     // resourceTypes =
 *     // {
 *     //     "MyResourceType1": {
 *     //         "0.0.1": {
 *     //             name: 'MyResourceType1',
 *     //             version: '0.0.1',
 *     //             interfaces: [ 'MyInterfaceType1' ]
 *     //         }
 *     //     },
 *     //     "MyResourceType2": {
 *     //         "0.0.1": {
 *     //             name: 'MyResourceType2',
 *     //             version: '0.0.1',
 *     //             interfaces: [ 'MyInterfaceType1', 'MyInterfaceType2' ]
 *     //         }
 *     //     }
 *     // }
 * });
 * ```
 */
HTTPPeer.prototype.listResourceTypes = function() {
    return this.sendHTTPGet('/resourceTypes');
};

/**
 * Lists all the interface type schemas
 *
 * @method listInterfaceTypes
 * @return {Promise} Upon success, the promise resolves to an object
 *   that contains information on all known interface types:
 *
 *   {
 *       "InterfaceType1": {
 *           "0.0.1": [InterfaceSchema],
 *           "0.0.2": [InterfaceSchema],
             ...
 *       },
 *       ...
 *   }
 * @example
 * ```
 * return dev$.addInterfaceType({
 *     name: 'MyInterfaceType1', // name is a string that is longer than 0 characters
 *     version: '0.0.1',        // version is a semantic version string
 *     commands: {              // commands is an object whose property names are non-empty strings
 *         myCommand1: {
 *             arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
 *             returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
 *         }
 *     },
 *     state: {
 *         myStateProperty1: {
 *             readOnly: true,   // readOnly is a boolean value
 *             schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
 *         }
 *     },
 *     events: {
 *         myEventType1: {
 *             schema: { type: 'string' }
 *         }
 *     }
 * }).then(function() {
 *     return dev$.addInterfaceType({
 *         name: 'MyInterfaceType2', // name is a string that is longer than 0 characters
 *         version: '0.0.1',        // version is a semantic version string
 *         commands: {              // commands is an object whose property names are non-empty strings
 *             myCommand2: {
 *                 arguments: [ { type: 'string' } ],  // arguments is an array of sub-schemas that describe the argument formats
 *                 returns: { type: 'number' }     // returns is a sub-schema that describes the return value format
 *             }
 *         },
 *         state: {
 *             myStateProperty2: {
 *                 readOnly: true,   // readOnly is a boolean value
 *                 schema: { type: 'number' }  // this should be a sub-schema that describes the format of this state property
 *             }
 *         },
 *         events: {
 *             myEventType2: {
 *                 schema: { type: 'string' }
 *             }
 *         }
 *     });
 * }).then(function() {
       return dev$.listInterfaceTypes();
 * }).then(function(interfaceTypes) {
 *     // interfaceTypes =
 *     // {
 *     //     "MyInterfaceType1": {
 *     //         "0.0.1": {
 *     //             ...
 *     //         }
 *     //     },
 *     //     "MyInterfaceType2": {
 *     //         "0.0.1": {
 *     //             ...
 *     //         }
 *     //     }
 *     // }
 * });
 * ```
 */
HTTPPeer.prototype.listInterfaceTypes = function() {
    return this.sendHTTPGet('/interfaceTypes');
};

HTTPPeer.prototype.getReachabilityMap = function() {
    return this.sendHTTPGet('/reachabilityMap');
};

HTTPPeer.prototype.getNodeID = function() {
    return this.sendHTTPGet('/nodeID').then(function(result) {
        return result.id;
    });
};

/**
 * Register a resource with this peer. After registering with
 * a resource, this peer is sent all control messages and
 * requests for that resource.
 *
 * @method registerResource
 * @return {Promise}
 * @example
 * ```
 * This method is called automatically when a resource controller instance is
 * created and its start method is called
 * ```
 */
HTTPPeer.prototype.registerResource = function(resourceID, resourceTypeName) {
    this.registeredResources[resourceID] = resourceTypeName;

    return this.sendHTTPPost('/register', {
        resourceID: resourceID,
        resourceType: resourceTypeName
    });
};

/**
 * List the versions of all the installed modules as well as
 * the version of DeviceJS that is running on the server.
 *
 * @method getVersions
 * @return {Promise}
 */
HTTPPeer.prototype.getVersions = function() {
    return this.sendHTTPGet('/versions');
};

/**
 * Lists the status of all installed modules on the server
 * including their version and enabled/disabled state
 *
 * @method getModules
 * @return {Promise}
 */
HTTPPeer.prototype.getModules = function() {
    return this.sendHTTPGet('/modules');
};

/**
 * Unregister a resource with this peer. The peer will no longer
 * receive control messages related to this resource
 *
 * @method unregisterResource
 * @return {Promise}
 * @example
 * ```
 * This method is called automatically when the stop meethod
 * of a resource controller instance is called
 * ```
 */
HTTPPeer.prototype.unregisterResource = function(resourceID) {
    delete this.registeredResources[resourceID];

    return this.sendHTTPPost('/unregister', {
        resourceID: resourceID
    });
};

/**
 * Forgets a resource. Normally resources are added to the index
 * after being registered for the first time. This function removes
 * the resources from the index and returns the database to a state
 * where it has no knowledge of this resource
 *
 * @method forgetResource
 * @return {Promise}
 */
HTTPPeer.prototype.forgetResource = function(resourceID) {
    return this.sendHTTPPost('/forget', {
        resourceID: resourceID
    });
};

HTTPPeer.prototype.attachSelection = function(selection) {
    this.selections[selection._id] = selection;
};

HTTPPeer.prototype.detachSelection = function(selection) {
    delete this.selections[selection._id];
};

/**
 * Subscribe to a certain type of event or events for a set of resources
 * or a particular resource
 *
 * @method subscribeToResourceEvent
 * @param {String} selection This describes the selection. It could be
 *   the ID of a resource, a resource group name, a resource type name,
 *   or an interface type name
 * @param {String} eventType The event type to listen to from this set
 *   of resources
 * @param {String} selectionID This identifies the selection object used
 *   to make the subscription
 * @return {Promise} The result contains the id of the subscription. This
 *   can be used as a handle to unsubscribe later
 * @example
 * ```
 * Rather than using this method directly, it is best to use it through a ResourceSelection
 * object. See the example for ResourceSelection#subscribeToEvent
 * ```
 */
HTTPPeer.prototype.subscribeToResourceEvent = function(selection, eventType, selectionID) {
    var self = this;

    if(!selectionID) {
        selectionID = 0;
    }

    return this.sendHTTPPost('/subscribe', {
        selection: selection,
        eventCategory: 'event',
        eventType: eventType,
        selectionID: selectionID
    }).then(function(result) {
        var subscriptionID = result.id;

        self.subscriptions.add(selection, eventType, selectionID, subscriptionID, 'event');

        return result
    });
};

/**
 * Unsubscribe from a certain type of event or events for a set of resources
 * or a particular resource
 *
 * @method unsubscribe
 * @param {String} selectionID This identifies the selection object used
 *   to make the subscription
 * @param {String} subscriptionID The id of the subscription to cancel. This
 *   is obtained in the success callback of the subscribe promise. If subscriptionID
 *   is omitted, this selection object will be unsubscribed from all subscriptions
 * @return {Promise}
 * @example
 * ```
 * Rather than using this method directly, it is best to use it through a ResourceSelection
 * object. See the example for ResourceSelection#unsubscribeFromEvent
 * ```
 */
HTTPPeer.prototype.unsubscribe = function(selectionID, subscriptionID) {
    if(!selectionID) {
        selectionID = 0;
    }

    try {
        if(!subscriptionID) {
            this.subscriptions.removeAll(selectionID);
        }
        else {
            this.subscriptions.remove(subscriptionID);
        }
    }
    catch(error) {
        return Promise.reject(new Error('Invalid selection string'));
    }

    return this.sendHTTPPost('/unsubscribe', {
        selectionID: selectionID,
        id: subscriptionID
    });
};

/**
 * Publish a resource event on behalf of a resource that is registered
 * to this peer. The DeviceJS server will send this event to all
 * relevant subscribers. Special event types include 'reachable',
 * and 'unreachable'. Emit these to indicate when a resource is reachable
 * or unreachable, for example when losing connectivity to a resource
 *
 * @method publishResourceEvent
 * @param {String} resourceID The ID of the resource publishing this event
 * @param {String} eventType The event type being published
 * @param eventData The data associated with this event
 * @return {Promise}
 * @example
 * ```
 * This method should not be used directly, but rather invoked indirectly
 * by creating a resource controller (See the DeviceJSPeer#resource method)
 * and having the code inside this resource controller call its emit method
 * The emit method is overridden for resource controllers and causes this method
 * to be invoked in the resource controller's underlying DeviceJSPeer
 * ```
 */
HTTPPeer.prototype.publishResourceEvent = function(resourceID, eventType, eventData) {
    return this.sendHTTPPost('/publish', {
        resourceID: resourceID,
        eventCategory: 'event',
        eventType: eventType,
        eventData: eventData
    });
};

/**
 * Resources can be organized into a hierarchy of groups
 * similar to a directory structure. This creates a resource
 * group of a certain name. Resource group names are a
 * series of strings delimited by forward slashes. Ex:
 *   a, a/b/c
 * Creating a resource group with parent groups that do
 * not yet exist implicitly creates those parent groups.
 * Creating a group that already exists has no effect
 *
 * @method createResourceGroup
 * @param {String} resourceGroupName The name of the resource group
 * @return {Promise}
 * @example
 * ```
 * dev$.createResourceGroup('A').then(function() {
 *     return dev$.createResourceGroup('B');
 * }).then(function() {
 *     return dev$.createResourceGroup('C');
 * }).then(function() {
 *     return dev$.createResourceGroup('A/B/C');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: {
 *      //             B: {
 *      //                 children: {
 *      //                     C: {
 *      //                         children: { },
 *      //                         resources: { }
 *      //                     }
 *      //                 },
 *      //                 resources: { }
 *      //             }
 *      //         },
 *      //         resources: { }
 *      //     },
 *      //     B: {
 *      //         children: { },
 *      //         resources: { }
 *      //     },
 *      //     C: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * });
 * ```
 */
HTTPPeer.prototype.createResourceGroup = function(resourceGroupName) {
    return this.sendHTTPPost('/createGroup', {
        groupName: resourceGroupName
    });
};

/**
 * Deleting a resource group removes all resources from
 * that group and recursively deletes all its children
 *
 * @method deleteResourceGroup
 * @param {String} resourceGroupName The name of the resource group
 * @return {Promise}
 * @example
 * ```
 * dev$.createResourceGroup('A').then(function() {
 *     return dev$.createResourceGroup('B');
 * }).then(function() {
 *     return dev$.createResourceGroup('C');
 * }).then(function() {
 *     return dev$.createResourceGroup('A/B/C');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: {
 *      //             B: {
 *      //                 children: {
 *      //                     C: {
 *      //                         children: { },
 *      //                         resources: { }
 *      //                     }
 *      //                 },
 *      //                 resources: { }
 *      //             }
 *      //         },
 *      //         resources: { }
 *      //     },
 *      //     B: {
 *      //         children: { },
 *      //         resources: { }
 *      //     },
 *      //     C: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * }).then(function() {
 *     return dev$.deleteResourceGroup('A/B');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { }
 *      //     },
 *      //     B: {
 *      //         children: { },
 *      //         resources: { }
 *      //     },
 *      //     C: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * });
 * ```
 */
HTTPPeer.prototype.deleteResourceGroup = function(resourceGroupName) {
    return this.sendHTTPPost('/deleteGroup', {
        groupName: resourceGroupName
    });
};

/**
 * Joining a resource to a resource group means
 * that this resource is controllable by sending
 * requests to that resource group and that any
 * events emitted by that resource will be emitted
 * to subscribers to this resource group
 *
 * @method joinResourceGroup
 * @param {String} resourceID The ID of the resource to add to this group
 * @param {String} resourceGroupName The name of the resource group to join
 * @return {Promise}
 * @example
 * ```
 * return dev$.createResourceGroup('A').then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * }).then(function() {
 *     // assumes myResource1 is the ID of a known resource
 *     return dev$.joinResourceGroup('myResource1', 'A');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { myResource1: { } }
 *      //     }
 *      // }
 * });
 * ```
 */
HTTPPeer.prototype.joinResourceGroup = function(resourceID, resourceGroupName) {
    return this.sendHTTPPost('/addToGroup', {
        groupName: resourceGroupName,
        resourceID: resourceID
    });
};

/**
 * Unjoins a resource from a resource group.
 *
 * @method leaveResourceGroup
 * @param {String} resourceID The ID of the resource to remove from this group
 * @param {String} resourceGroupName The name of the resource group to leave
 * @return {Promise}
 * @example
 * ```
 * return dev$.createResourceGroup('A').then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * }).then(function() {
 *     // assumes myResource1 is the ID of a known resource
 *     return dev$.joinResourceGroup('myResource1', 'A');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { myResource1: { } }
 *      //     }
 *      // }
 * }).then(function() {
 *     return dev$.leaveResourceGroup('myResource1', 'A');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * });
 * ```
 */
HTTPPeer.prototype.leaveResourceGroup = function(resourceID, resourceGroupName) {
    return this.sendHTTPPost('/removeFromGroup', {
        groupName: resourceGroupName,
        resourceID: resourceID
    });
};

/**
 * Sends a command to the set of resources specified
 * by the selection type and selection.
 *
 * @method sendResourceCommand
 * @param {String} selection
 * @param {String} command The command name to be excuted by the resources
 * @param {Array} arguments The arguments array to be applied to the command
 * @return {Promise} When this promise resolves, it includes a map of
 *   resourceID to response to this command. If a resource was unreachable
 *   a flag in the response, receivedResponse, is set to false indicating
 *   as much.
 * @example
 * ```
 * This method should not be invoked directly, but rather through the ResourceSelection
 * interface. By invoking the ResourceSelection#call method, this method is invoked implicitly
 * using the selection specified by that ResourceSelection object and the command name and arguments
 * specified by the parameters passed into the ResourceSelection#call method
 * ```
 */
HTTPPeer.prototype.sendResourceCommand = function(selection, command, arguments) {
    return this.sendHTTPPost('/request', {
        requestCategory: 'command',
        selection: selection,
        command: { command: command, arguments: arguments }
    });
};

/**
 * This peer is subscribed to changes in resource state
 * published by resources in the specified set
 *
 * @method subscribeToResourceState
 * @param {String} selection
 * @param {String} property The property to subscribe to in this set
 * @param {String} selectionID The id of the selection object that made
 *   this subscription
 * @return {Promise} The subscription ID is returned in the success callback
 * @example
 * ```
 * Rather than using this method directly, it is best to use it through a ResourceSelection
 * object. See the example for ResourceSelection#subscribeToState
 * ```
 */
HTTPPeer.prototype.subscribeToResourceState = function(selection, property, selectionID) {
    var self = this;

    if(!selectionID) {
        selectionID = 0;
    }

    return this.sendHTTPPost('/subscribe', {
        selection: selection,
        eventCategory: 'state',
        eventType: property,
        selectionID: selectionID
    }).then(function(result) {
        var subscriptionID = result.id;

        self.subscriptions.add(selection, property, selectionID, subscriptionID, 'state');

        return result;
    });
};

/**
 * Publish a resource state change event on behalf of
 * a resource that is registered to this peer
 *
 * @method publishResourceStateChange
 * @param {String} resourceID The ID of the resource that is publishing
 *   this event.
 * @param {String} property The name of the property that has changed
 * @param {String} value The new value of the property
 * @return {Promise}
 * @example
 * ```
 * This method should never be invoked directly. It is automatically called
 * when a resource controller's state setters is called.
 * ```
 */
HTTPPeer.prototype.publishResourceStateChange = function(resourceID, property, value) {
    return this.sendHTTPPost('/publish', {
        resourceID: resourceID,
        eventCategory: 'state',
        eventType: property,
        eventData: value
    });
};

/**
 * Send a request to a set of resources to set some
 * property to a new value
 *
 * @method setResourceState
 * @param {String} selection
 * @param {String} property The name of the property to set
 * @param {String} value The new value of the property
 * @return {Promise} This resolves with the same object format as
 *   sendResourceCommand. A flag indicates if a response was received
 *   from the given resources that belonged to the set
 * @example
 * ```
 * This method should be invoked indirectly by using the ResourceSelection#set
 * method.
 * ```
 */
HTTPPeer.prototype.setResourceState = function(selection, property, value) {
    return this.sendHTTPPost('/request', {
        requestCategory: 'state set',
        selection: selection,
        command: { property: property, value: value }
    });
};

/**
 * Send a request to a get of resources to get the state
 * of some property.
 *
 * @method getResourceState
 * @param {String} selection
 * @param {String} property The name of the property to get
 * @return {Promise} This resolves with the same object format as
 *   sendResourceCommand. A flag indicates if a response was received
 *   from the given resources that belonged to the set
 * @example
 * ```
 * This method should be invoked indirectly by using the ResourceSelection#get
 * method.
 * ```
 */
HTTPPeer.prototype.getResourceState = function(selection, property) {
    return this.sendHTTPPost('/request', {
        requestCategory: 'state get',
        selection: selection,
        command: { property: property }
    });
};

/**
 * After receiving a command event, a state set event,
 * or a state get event the peer must response on behalf
 * of a given resource once that resource has fulfilled
 * the request.
 *
 * @method responseToCommand
 * @param {String} commandID The commandID associated with this
 *   response
 * @param {String} resourceID The resource that is responding
 * @param response The value associated with this response
 * @return {Promise}
 * @example
 * ```
 * This method is invoked automatically by the resource controller's code
 * when a command returns a promise and that promise resolves or rejects, the command
 * returns a non-promise value or the command throws an exception
 * ```
 */
HTTPPeer.prototype.respondToCommand = function(commandID, resourceID, response) {
    return this.sendSocket('response', {
        commandID: commandID,
        resourceID: resourceID,
        response: response
    })
};

/**
 * Enumerates the resources associated with a certain selection
 *
 * @method listResources
 * @param {String} selection
 * @return {Promise} Resolves with a set of resources
 * @example
 * ```
 * dev$.registerResource('myResource1', 'MyResourceType').then(function() {
 *     return dev$.registerResource('myResource2', 'MyResourceType');
 * }).then(function() {
 *     return dev$.registerResource('myResource3', 'MyResourceType');
 * }).then(function() {
 *     return dev$.listResources('type="MyResourceType"');
 * }).then(function(resources) {
 *     // {
 *     //     myResource1: {
 *     //         reachable: true,
 *     //         registered: true,
 *     //         type: 'MyResourceType'
 *     //     },
 *     //     myResource2: {
 *     //         reachable: true,
 *     //         registered: true,
 *     //         type: 'MyResourceType'
 *     //     },
 *     //     myResource3: {
 *     //         reachable: true,
 *     //         registered: true,
 *     //         type: 'MyResourceType'
 *     //     }
 *     // }
 * });
 * ```
 */
HTTPPeer.prototype.listResources = function(selection) {
    return this.sendHTTPPost('/list', {
        selection: selection
    });
};

HTTPPeer.prototype.alert = function(name, level, status, metadata) {
    if(ddb && ddb.alerts) {
        if(status) {
            return ddb.alerts.raiseAlert(name, level, metadata)
        }
        else {
            return ddb.alerts.lowerAlert(name, level, metadata)
        }
    }
    else {
        return Promise.reject('No ddb object initialized')
    }
};

/**
 * Returns a hierarchy of groups and the resources
 * contained within them
 *
 * @method getResourceGroup
 * @param {String} groupName
 * @return {Promise} Resolves with a hierarchy of resources
 * @example
 * ```
 * return dev$.createResourceGroup('A').then(function() {
 *     return dev$.createResourceGroup('B');
 * }).then(function() {
 *     return dev$.createResourceGroup('C');
 * }).then(function() {
 *     return dev$.createResourceGroup('A/B/C');
 * }).then(function() {
 *     return dev$.getResourceGroup();
 * }).then(function(group) {
 *      // {
 *      //     A: {
 *      //         children: {
 *      //             B: {
 *      //                 children: {
 *      //                     C: {
 *      //                         children: { },
 *      //                         resources: { }
 *      //                     }
 *      //                 },
 *      //                 resources: { }
 *      //             }
 *      //         },
 *      //         resources: { }
 *      //     },
 *      //     B: {
 *      //         children: { },
 *      //         resources: { }
 *      //     },
 *      //     C: {
 *      //         children: { },
 *      //         resources: { }
 *      //     }
 *      // }
 * }).then(function() {
 *     return dev$.getResourceGroup('A');
 * }).then(function(group) {
 *      // {
 *      //     children: {
 *      //         B: {
 *      //             children: {
 *      //                 C: {
 *      //                     children: { },
 *      //                     resources: { }
 *      //                 }
 *      //             },
 *      //             resources: { }
 *      //         }
 *      //     }
 *      // }
 * }).then(function() {
 *     return dev$.getResourceGroup('A/B');
 * }).then(function(group) {
 *      // {
 *      //     children: {
 *      //         C: {
 *      //             children: { },
 *      //             resources: { }
 *      //         }
 *      //     },
 *      //     resources: { }
 *      // }
 * });
 * ```
 */
HTTPPeer.prototype.getResourceGroup = function(groupName) {
    if(typeof groupName !== 'string') {
        groupName = '';
    }

    return this.sendHTTPGet('/group?group='+groupName);
};

HTTPPeer.prototype.updateResourceGraph = function(updates) {
    return this.sendHTTPPost('/graphUpdates', updates)
};

HTTPPeer.prototype.queryResourceGraph = function(resources) {
    let query = '?'
    
    for(let resource of resources) {
        query += 'node=' + encodeURIComponent(resource) + '&'
    }

    return this.sendHTTPGet('/graph' + query)
}

/**
 * A convenience method for creating a new
 * ResourceController constructor
 *
 * @method resource
 * @param {String} The resource type name
 * @param {Object} implementation The api of the resource controller
 * @return {ResourceController} The new constructor
 * @example
 * ```
 * var ExampleMotionSensor = dev$.resource('Examples/ExampleMotionSensor', {
 *     start: function(options) {
 *         var self = this;
 *
 *         console.log('Start ExampleMotionSensor');
 *
 *         this._motionSenseInterval = setInterval(function() {
 *             self.emit('motion', Math.random());
 *         }, 4000);
 *     },
 *     stop: function() {
 *         clearInterval(this._motionSenseInterval);
 *     },
 *     state: { },
 *     commands: { }
 * });
 *
 * var ExampleLight = dev$.resource('Examples/ExampleLight', {
 *     start: function(options) {
 *         console.log('Start ExampleLight');
 *         this._power = 'off';
 *         this._brightness = 0.0;
 *     },
 *     stop: function() {
 *     },
 *     state: {
 *         power: {
 *             get: function() {
 *                 return this._power;
 *             },
 *             set: function(value) {
 *                 console.log('SET POWER', value);
 *                 this._power = value;
 *             }
 *         },
 *         brightness: {
 *             get: function() {
 *                 return this._brightness;
 *             },
 *             set: function(value) {
 *                 console.log('SET BRIGHTNESS %d %%', parseInt(this._brightness*100));
 *                 this._brightness = value;
 *             }
 *         }
 *     },
 *     commands: {
 *         on: function() {
 *             console.log('TURN ON LIGHT');
 *             return this.state.power.set('on');
 *         },
 *         off: function() {
 *             console.log('TURN OFF LIGHT');
 *             return this.state.power.set('off');
 *         }
 *     }
 * });
 *  ```
 */
HTTPPeer.prototype.resource = function(resourceType, implementation) {
    return new ResourceController(resourceType, implementation, this);
};

/**
 * A convenience method for generating new uuids
 *
 * @method uuid
 * @return {String} A hex encoded uuid string
 */
HTTPPeer.prototype.uuid = function() {
    return makeUUIDHex();
};

/**
 * A convenience method for generating a new
 * ResourceSelection by resource ID
 *
 * @method selectByID
 * @param {String} resourceID
 * @return {ResourceSelection}
 */
HTTPPeer.prototype.selectByID = function(resourceID) {
    return this.select('id='+toProperty(resourceID));
};

/**
 * A convenience method for generating a new
 * ResourceSelection by resource interface
 *
 * @method selectByInterface
 * @param {String} resourceInterface
 * @return {ResourceSelection}
 */
HTTPPeer.prototype.selectByInterface = function(resourceInterface) {
    return this.select('interface='+toProperty(resourceInterface));
};

/**
 * A convenience method for generating a new
 * ResourceSelection by resource type
 *
 * @method selectByType
 * @param {String} resourceType
 * @return {ResourceSelection}
 */
HTTPPeer.prototype.selectByType = function(resourceType) {
    return this.select('type='+toProperty(resourceType));
};

/**
 * A convenience method for generating a new
 * ResourceSelection by resource group
 *
 * @method selectByGroup
 * @param {String} group The resource group name
 * @return {ResourceSelection}
 */
HTTPPeer.prototype.selectByGroup = function(group) {
    return this.select('group='+toProperty(group));
};

/**
 * Generate a new ResourceSelection
 * by selection string
 *
 * @method select
 * @param {String} selection The selection string
 *   Selection String Format:
 *   <predicate>      ::= <term> | <term> 'or' <predicate>
 *   <term>           ::= <factor> | <factor> 'and' <term>
 *   <factor>         ::= <property> | '(' <predicate> ')' | 'not' <factor>
 *   <property>       ::= <property-name> '=' <property-value>
 *   <property-name>  ::= 'interface' | 'group' | 'type' | 'id'
 *   <property-value> ::= '*' | \"([^\"\\]|\\"|\\\\|\\\/|\\b|\\f|\\n|\\r|\\t|(\\u([0-9A-F]{4}|([0-9a-f]{4}))))*\"
 * @return {ResourceSelection}
 * @example
 * ```
 * dev$.select('type="MyResourceType1"')
 * dev$.select('interface="Switchable"')
 * dev$.select('group="A/B"')
 * dev$.select('id="device123abc"')
 * dev$.select('interface="Switchable" and group="A/B"')
 * dev$.select('interface="Switchable" or group="A/B"')
 * dev$.select('(type="MyResourceType1" or group="A/B") and interface="Dimmable"')
 * ...
 * ```
 */
HTTPPeer.prototype.select = function(selection) {
    return new ResourceSelection(this, selection, this.nextSelectionID++);
};

/**
 * A resource selection object builds all its functionality
 * on the APIs provided by the DeviceJSPeer object that
 * it is tied to. A resource selection represents some
 * selection or set of resources which are to be monitored or
 * manipulated. It is a more convenient interface than
 * the raw API provided by DeviceJSPeer for performing these
 * tasks and is the primary method by which user code should
 * operate. Keep in mind that this object should be created
 * through the dev$.select functions and not by invoking
 * its constructor directly
 *
 * @class ResourceSelection
 * @constructor
 * @param {DeviceJSPeer} peer The DeviceJS peer that this resource selection
 *   is tied to.
 * @param {String} selection
 */
var ResourceSelection = function(peer, selection, selectionID) {
    var self = this;

    EventEmitter.call(this);

    this._selection = selection;
    this._peer = peer;
    this._pendingCommands = { };
    this._id = selectionID;

    // This function exists to filter out unrelated events
    // The peer receives messages for all resources that
    // are registered with it and for all subscriptions
    // it has made. A certain resource selection only pertains
    // to a subset of those events. This function determines
    // if incoming messages are relevant to this resource
    // selection
    function selectionsMatch(expected, received) {
        expected = expected.split('/');
        received = received.split('/');

        for(var i=0;i<expected.length;i++) {
            var expectedPart = expected[i];
            var receivedPart = received[i];

            // there is no more
            if(expectedPart == '#') {
                return true;
            }
            else if(expectedPart == '+') {
                if(typeof receivedPart === 'undefined') {
                    return false;
                }
            }
            else if(expectedPart != receivedPart) {
                return false;
            }
        }

        return true;
    }

    this._peerListeners = {
        'state': {
            handler: function(resourceID, property, value, selectionID) {
                if(self._id == selectionID) {
                    self.emit('state', resourceID, property, value);
                }
            },
            name: 'state change'
        },
        'event': {
            handler: function(resourceID, type, data, selectionID) {
                if(self._id == selectionID) {
                    self.emit('event', resourceID, type, data);
                }
            },
            name: 'event'
        }
    };

    this._selectionListeners = { 'state': [ ], 'event': [ ] };
};

ResourceSelection.prototype = Object.create(EventEmitter.prototype);

ResourceSelection.prototype.addListener = function() {
    return ResourceSelection.prototype.on.apply(this, arguments);
};

ResourceSelection.prototype.on = function(event, listener) {
    // for these events, we only attach a listener to the peer
    // if a listener is attached to this object. this way,
    // there is not a memory leak if someone has code that continuously
    // calls selectBy something and does not keep track of the object
    // and does not listen to any events with it
    if(this._peerListeners[event]) {
        if(!this._selectionListeners[event].length) {
            this._peer.attachSelection(this);
            this._peer.on(this._peerListeners[event].name, this._peerListeners[event].handler);
        }

        this._selectionListeners[event].push(listener);
    }

    return EventEmitter.prototype.on.apply(this, arguments);
};

ResourceSelection.prototype.once = function(event, listener) {
    var self = this;

    if(this._peerListeners[event]) {
        if(!this._selectionListeners[event].length) {
            this._peer.attachSelection(this);
            this._peer.on(this._peerListeners[event].name, this._peerListeners[event].handler);
        }

        this._selectionListeners[event].push(listener);

        var oldListener = listener;

        listener = function() {
            self._selectionListeners[event].splice(self._selectionListeners[event].indexOf(oldListener), 1);

            if(!self._peerListeners[event].length) {
                this._peer.detachSelection(this);
                self._peer.removeListener(self._peerListeners[event].name, self._peerListeners[event].handler);
            }

            return oldListener.apply(self, arguments);
        };
    }

    return EventEmitter.prototype.once.apply(this, arguments);
};

ResourceSelection.prototype.removeListener = function(event, listener) {
    if(this._peerListeners[event]) {
        if(this._selectionListeners[event].indexOf(listener) != -1) {
            this._selectionListeners[event].splice(this._selectionListeners[event].indexOf(listener), 1);
        }

        if(!this._selectionListeners[event].length) {
            this._peer.detachSelection(this);
            this._peer.removeListener(this._peerListeners[event].name, this._peerListeners[event].handler);
        }
    }

    return EventEmitter.prototype.removeListener.apply(this, arguments);
};

ResourceSelection.prototype.removeAllListeners = function(event) {
    if(this._peerListeners[event]) {
        this._selectionListeners[event] = [ ];
        this._peer.detachSelection(this);
        this._peer.removeListener(this._peerListeners[event].name, this._peerListeners[event].handler);
    }

    return EventEmitter.prototype.removeAllListeners.apply(this, arguments);
};

/**
 * This is fired when a resource in this selection
 * publishes a state change
 *
 * @event state
 * @param {String} resourceID The source of this event
 * @param {String} property The property that has changed
 * @param value The new value of this property
 */

/**
 * This is fired when a resource in this selection
 * publishes an event
 *
 * @event event
 * @param {String} resourceID The source of this event
 * @param {String} type The type of event
 * @param data Any data associated with the event
 */

/**
 * This is fired when a resource in this selection
 * is discovered
 *
 * @event discover
 * @param {String} resourceID The source of this event
 * @param {Object} resourceInfo Information about the discovered resource
 */

/**
 * This method wraps the subscribeToResourceEvent method
 * defined by DeviceJSPeer
 *
 * @method subscribeToEvent
 * @param {String} eventType The type of event to subscribe to
 * @return {Promise}
 * @example
 * ```
 * var motionSensors = dev$.selectByType('Examples/ExampleMotionSensor');
 * motionSensors.subscribeToEvent('motion');
 * motionSensors.on('event', function(resourceID, eventName, eventData) {
 *     if(eventName == 'motion') {
 *         console.log('Saw a motion event from resource', resourceID);
 *     }
 * });
 * ```
 */
ResourceSelection.prototype.subscribeToEvent = function(eventType) {
    return this._peer.subscribeToResourceEvent(this._selection, eventType, this._id);
};

/**
 * This method wraps the subscribeToResourceState method
 * defined by DeviceJSPeer
 *
 * @method subscribeToState
 * @param {String} property The type of property to subscribe to
 * @return {Promise}
 * @example
 * ```
 * var lights = dev$.selectByType('Examples/ExampleLight');
 * lights.subscribeToState('power');
 * lights.on('state', function(resourceID, stateName, stateData) {
 *     console.log('Resource', resourceID, 'changed its power state to', stateData);
 * });
 * ```
 */
ResourceSelection.prototype.subscribeToState = function(property) {
    return this._peer.subscribeToResourceState(this._selection, property, this._id);
};

/**
 * This method wraps the unsubscribe method
 * defined by DeviceJSPeer
 *
 * @method unsubscribe
 * @param {String} subscriptionID The id of the subscription to cancel obtained from a previous call to subscribe()
 * @return {Promise}
 * @example
 * ```
 * var motionSensors = dev$.selectByType('Examples/ExampleMotionSensor');
 * var subscriptionID
 * motionSensors.subscribeToEvent('motion').then(function(result) {
 *     subscriptionID = result.id
 * })
 *
 * motionSensors.on('event', function(resourceID, eventName, eventData) {
 *     if(eventName == 'motion') {
 *         console.log('Saw a motion event from resource', resourceID);
 *         motionSensors.unsubscribe(subscriptionID); // tell server to stop sending these events to me
 *     }
 * });
 * ```
 */
ResourceSelection.prototype.unsubscribe = function(subscriptionID) {
    return this._peer.unsubscribe(this._id, subscriptionID);
};

/**
 * This method wraps the listResources method
 * defined by DeviceJSPeer. It lists all the resources
 * in this resource selection.
 *
 * @method listResources
 * @return {Promise} This is the promise returned by DeviceJSPeer's
 *   listResources method.
 * @example
 * ```
 * dev$.selectByType('Examples/ExampleLight').listResources().then(function(resources) {
 *     // {
 *     //     light1: {
 *     //         reachable: true,
 *     //         registered: true,
 *     //         type: 'Examples/ExampleLight'
 *     //     }
 *     // }
 * });
 * ```
 */
ResourceSelection.prototype.listResources = function() {
    var self = this;

    return self._peer.listResources(self._selection);
};

/**
 * This initiates the discovery process for resources
 * matching this selection set. If any resources are
 * already registered matching this selection then those
 * will be discovered. After that, any new resource
 * joining this set will be discovered.
 *
 * @method discover
 * @param {Boolean} [localOnly] This defaults to false. If true
 *   only resources registered to peers connected directly to the
 *   same DeviceJS server will be discovered.
 * @example
 * ```
 * var lights = dev$.selectByType('Examples/ExampleLight');
 * lights.discover();
 * lights.on('discover', function(resourceID, resourceInfo) {
 *     // resourceID = light1
 *     // resourceInfo = { reachable: true, registered: true, type: 'Examples/ExampleLight' }
 * });
 * ```
 */
ResourceSelection.prototype.discover = function(localOnly) {
    // start searching
    var self = this;

    self.stopDiscovering()

    function poll() {
        self.listResources().then(function(selectionSet) {
            Object.keys(selectionSet).forEach(function(resourceID) {
                if(selectionSet[resourceID].registered) {
                    if(self._isDiscovering) {
                        self.emit('discover', resourceID, selectionSet[resourceID]);
                    }
                }
            })
        })
    }

    self._isDiscovering = true
    self._discoverOnConnect = function() {
        poll()
    }

    self._discoverOnDiscover = function(resourceID, type, data, selectionID) {
        if(self._id == selectionID && type == 'discovery') {
            var resourceTypeDefinition = data.definition
            self.emit('discover', resourceID, { registered: true, reachable: true, type: resourceTypeDefinition.name })
        }
    }

    self._peer.on('connect', self._discoverOnConnect)
    self._peer.on('event', self._discoverOnDiscover)

    return self.subscribeToEvent('discovery').then(function(result) {
        self._discoverySubscriptionID = result.id
        poll()
    }, function(error) {
        self.stopDiscovering()
        throw error
    })
};

/**
 * Stops the discovery process
 *
 * @method stopDiscovering
 * @example
 * ```
 * var lights = dev$.selectByType('Examples/ExampleLight');
 * lights.discover();
 * lights.on('discover', function(resourceID, resourceInfo) {
 *     // resourceID = light1
 *     // resourceInfo = { reachable: true, registered: true, type: 'Examples/ExampleLight' }
 *     lights.stopDiscovering(); // this selection will no longer emit discover events
 * });
 * ```
 */
ResourceSelection.prototype.stopDiscovering = function() {
    this._isDiscovering = false
    this.unsubscribe(this._discoverySubscriptionID)
    this._peer.removeListener('connect', this._discoverOnConnect || function() { })
    this._peer.removeListener('event', this._discoverOnDiscover || function() { })
};

/**
 * Execute a certain command. All parameters
 * after the first parameter are considered
 * command arguments and are passed to the command
 * as an array.
 *
 * @method call
 * @param {String} command The name of the command to execute
 *   on this selection
 * @return {Promise} This is the promise returned by DeviceJSPeer's
 *   sendResourceCommand method
 * @example
 * ```
 * dev$.selectByType('Examples/ExampleLight').call('on').then(function() {
 *     console.log('Turned on all ExampleLight lights');
 * });
 * ```
 */
ResourceSelection.prototype.call = function(command) {
    // let server worry about all multi-response handling
    var self = this;
    var args = [ ];

    for(var i=1;i<arguments.length;i++) {
        args.push(arguments[i]);
    }

    return self._peer.sendResourceCommand(self._selection, command, args);
};

/**
 * Set a property of all resources in
 * this resource selection to some value
 *
 * @method set
 * @param {String} property The name of the property
 * @param value The value to set it to
 * @return {Promise} This is the promise returned by DeviceJSPeer's
 *   setResourceState method
 * @example
 * ```
 * dev$.selectByType('Examples/ExampleLight').set('brightness', 0.5).then(function() {
 *     console.log('Set all ExampleLight lights\' brightness to 50%'');
 * });
 * ```
 */
ResourceSelection.prototype.set = function(property, value) {
    var self = this;

    if(arguments.length == 1) {
        value = property
        property = ''
    }

    return self._peer.setResourceState(self._selection, property, value);
};

/**
 * Get a property of all resources in
 * this resource selection
 *
 * @method get
 * @param {String} property The name of the property
 * @return {Promise} This is the promise returned by DeviceJSPeer's
 *   getResourceState method
 * @example
 * ```
 * dev$.selectByType('Examples/ExampleLight').get('brightness').then(function(responses) {
 *     // responses =
 *     // {
 *     //     light1: { receivedResponse: true, response: 0.64 }
 *     // }
 * });
 */
ResourceSelection.prototype.get = function(property) {
    var self = this;

    if(arguments.length == 0) {
        property = ''
    }

    return self._peer.getResourceState(self._selection, property);
};

ResourceSelection.prototype.attachMethods = function() {
    var resourceTypeNames = { };
    var interfaceNames = { };
    var resourceTypeDefinitions = { };
    var commandNames = { };
    var stateNames = { };
    var self = this;

    return this.listResources().then(function(resources) {
        Object.keys(resources).forEach(function(resourceID) {
            resourceTypeNames[resources[resourceID].type] = true;
        });

        return self._peer.listResourceTypes();
    }).then(function(resourceTypeDefinitions) {
        Object.keys(resourceTypeDefinitions).forEach(function(resourceTypeName) {
            if(resourceTypeNames[resourceTypeName]) {
                var resourceTypeDefinition = resourceTypeDefinitions[resourceTypeName];
                resourceTypeDefinition = resourceTypeDefinition[Object.keys(resourceTypeDefinition)[0]];
                resourceTypeDefinition.interfaces.forEach(function(interfaceName) {
                    interfaceNames[interfaceName] = true;
                })
            }
        });

        return self._peer.listInterfaceTypes();
    }).then(function(interfaceTypes) {
        Object.keys(interfaceNames).forEach(function(interfaceName) {
            var interfaceDefinition = interfaceTypes[interfaceName];

            if(interfaceDefinition) {
                interfaceDefinition = interfaceDefinition[Object.keys(interfaceDefinition)[0]];
                Object.keys(interfaceDefinition.commands).forEach(function(commandName) {
                    commandNames[commandName] = true;
                });

                Object.keys(interfaceDefinition.state).forEach(function(stateName) {
                    stateNames[stateName] = true;
                });
            }
        });
    }).then(function() {
        Object.keys(stateNames).forEach(function(stateName) {
            if(typeof self[stateName] === 'undefined') {
                self[stateName] = function() {
                    if(arguments.length == 1) {
                        // treat as a setter
                        return this.set(stateName, arguments[0]);
                    }
                    else {
                        // treat as a getter
                        return this.get(stateName);
                    }
                }.bind(self);
            }
        });

        Object.keys(commandNames).forEach(function(commandName) {
            if(typeof self[commandName] === 'undefined') {
                self[commandName] = function() {
                    var args = [ commandName ];
                    args.push.apply(args, arguments);

                    return this.call.apply(this, args);
                }.bind(self);
            }
        });
    });
};

var ResourceController = function(resourceType, api, defaultDJSPeer) {
    var start = api.start;
    var stop = api.stop;
    var state = api.state;
    var setState = api.setState;
    var getState = api.getState;
    var commands = api.commands;

    // sanitize the inputs/verify the format of it all
    if(!(start instanceof Function)) {
        throw new TypeError('start must be defined');
    }

    if(!(stop instanceof Function)) {
        throw new TypeError('stop must be defined');
    }

    if(typeof state !== 'object') {
        state = { };
    }

    if(typeof commands !== 'object') {
        commands = { };
    }

    if(!(setState instanceof Function)) {
        setState = function(s) {
            var self = this

            return Promise.all(Object.keys(s).map(function(property) {
                return self.state[property].set(s[property])
            })).then(function() {
            })
        }
    }

    if(!(getState instanceof Function)) {
        getState = function(s) {
            var self = this
            var fullState = { }

            return Promise.all(Object.keys(self.state).map(function(property) {
                return self.state[property].get().then(function(value) {
                    fullState[property] = value
                })
            })).then(function() {
                return fullState
            })
        }
    }

    Object.keys(state).forEach(function(stateProperty) {
        if(typeof state[stateProperty] !== 'object') {
            delete state[stateProperty];
        }
        else {
            if(!(state[stateProperty].get instanceof Function)) {
                throw new TypeError('state property ' + stateProperty + ' has no get function');
            }

            if(!(state[stateProperty].set instanceof Function)) {
                throw new TypeError('state property ' + stateProperty + ' has no set function');
            }
        }
    });

    Object.keys(commands).forEach(function(commandName) {
        if(!(commands[commandName] instanceof Function)) {
            delete commands[commandName];
        }
    });

    var ResourceControllerType = function(resourceID, djsPeer) {
        var self = this;
        var myState = { };
        var myCommands = { };

        if(arguments.length == 1) {
            djsPeer = defaultDJSPeer;
        }

        Object.keys(state).forEach(function(stateProperty) {
            var accessor = { };
            var getter = function(metadata) {
                return new Promise(function(resolve, reject) {
                    try {
                        resolve(state[stateProperty].get.call(self, metadata));
                    }
                    catch(error) {
                        reject(error);
                    }
                });
            };

            var setter = function(value, metadata) {
                return new Promise(function(resolve, reject) {
                    try {
                        resolve(state[stateProperty].set.call(self, value, metadata));
                    }
                    catch(error) {
                        reject(error);
                    }
                }).then(function() {
                    self._peer.publishResourceStateChange(self._resourceID, stateProperty, value);
                });
            };

            Object.defineProperty(accessor, 'get', { writable: false, value: getter });
            Object.defineProperty(accessor, 'set', { writable: false, value: setter });
            Object.defineProperty(myState, stateProperty, { writable: false, enumerable: true, value: accessor });
        });

        Object.keys(commands).forEach(function(commandName) {
            myCommands[commandName] = commands[commandName];
            Object.defineProperty(myCommands, commandName, { writable: false, enumerable: true, value: commands[commandName].bind(self) });
        });

        Object.defineProperty(this, '_resourceID', { writable: false, value: resourceID });
        Object.defineProperty(this, '_peer', { writable: false, value: djsPeer });
        Object.defineProperty(this, '_apiStart', { writable: false, value: start.bind(self) });
        Object.defineProperty(this, '_apiStop', { writable: false, value: stop.bind(self) });
        Object.defineProperty(this, 'setState', { writable: false, value: setState.bind(self) });
        Object.defineProperty(this, 'getState', { writable: false, value: getState.bind(self) });
        Object.defineProperty(this, 'state', { writable: false, value: myState });
        Object.defineProperty(this, 'commands', { writable: false, value: myCommands });
    };

    ResourceControllerType.prototype = Object.create(EventEmitter.prototype);

    ResourceControllerType.prototype.emit = function(eventName, eventData) {
        EventEmitter.prototype.emit.apply(this, arguments);

        var args = [];

        for(var i=1;i<arguments.length;i++) {
            args.push(arguments[i]);
        }

        this._peer.publishResourceEvent(this._resourceID, eventName, eventData);
    };

    // re-attempts resource registration until it is successful
    ResourceControllerType.prototype._registerResource = function() {
        var self = this;

        return new Promise(function(resolve, reject) {
            function tryAgain() {
                self._peer.registerResource(self._resourceID, resourceType).then(resolve).catch(function(error) {
                    console.error('Error: ResourceController#start %s %s while attempting to register resource. Will retry in 5 seconds: ', self._resourceID, resourceType, error)

                    setTimeout(tryAgain, 5000)
                })
            }

            tryAgain()
        })
    };

    ResourceControllerType.prototype.start = function(options) {
        var self = this;
        var resourceID = this._resourceID;

        return self._registerResource().then(function() {
            self._peer.removeListener('command', self._onCommand || function() { })
            self._peer.removeListener('state set', self._onStateSet || function() { })
            self._peer.removeListener('state get', self._onStateGet || function() { })
            
            self._onCommand = function(command, argumentList, resourceSet, commandID, selectionString) {
                if(resourceSet.indexOf(self._resourceID) == -1) {
                    // ignore. this command is not bound for us
                    return;
                }

                new Promise(function(resolve, reject) {
                    try {
                        argumentList.push({
                            commandID: commandID,
                            selection: selectionString,
                            resourceSet: resourceSet
                        });

                        resolve(self.commands[command].apply(self, argumentList));
                    }
                    catch(error) {
                        reject(error);
                    }

                    argumentList.pop();
                }).then(function(result) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: result, error: null });
                }, function(error) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: null, error: 'Error: ' + error });
                });
            }
            
            self._onStateSet = function(property, value, resourceSet, commandID, selectionString) {
                if(resourceSet.indexOf(self._resourceID) == -1) {
                    // ignore. this command is not bound for us
                    return;
                }

                new Promise(function(resolve, reject) {
                    try {
                        if(!property) {
                            resolve(self.setState(value, {
                                commandID: commandID,
                                selection: selectionString,
                                resourceSet: resourceSet
                            }));
                        }
                        else {
                            resolve(self.state[property].set(value, {
                                commandID: commandID,
                                selection: selectionString,
                                resourceSet: resourceSet
                            }));
                        }
                    }
                    catch(error) {
                        reject(error);
                    }
                }).then(function(result) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: result, error: null });
                }, function(error) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: null, error: 'Error: ' + error });
                });
            }
            
            self._onStateGet = function(property, resourceSet, commandID, selectionString) {
                if(resourceSet.indexOf(self._resourceID) == -1) {
                    // ignore. this command is not bound for us
                    return;
                }

                new Promise(function(resolve, reject) {
                    try {
                        if(!property) {
                            resolve(self.getState({
                                commandID: commandID,
                                selection: selectionString,
                                resourceSet: resourceSet
                            }))
                        }
                        else {
                            resolve(self.state[property].get({
                                commandID: commandID,
                                selection: selectionString,
                                resourceSet: resourceSet
                            }));
                        }
                    }
                    catch(error) {
                        reject(error);
                    }
                }).then(function(result) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: result, error: null });
                }, function(error) {
                    self._peer.respondToCommand(commandID, self._resourceID, { result: null, error: 'Error: ' + error });
                });
            }
            
            self._peer
                .on('command', self._onCommand)
                .on('state set', self._onStateSet)
                .on('state get', self._onStateGet);

            return new Promise(function(resolve, reject) {
                resolve(self._apiStart(options));
            });
        });
    };

    ResourceControllerType.prototype.stop = function() {
        return new Promise(function(resolve, reject) {
            resolve(this._apiStop());
        }.bind(this)).then(function() {
            this._peer.removeListener('command', this._onCommand || function() { })
            this._peer.removeListener('state set', this._onStateSet || function() { })
            this._peer.removeListener('state get', this._onStateGet || function() { })
            
            return this._peer.unregisterResource(this._resourceID);
        }.bind(this));
    };

    return ResourceControllerType;
};

module.exports = HTTPPeer;
