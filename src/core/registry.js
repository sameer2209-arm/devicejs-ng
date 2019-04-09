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

var uuid = require('node-uuid');
var selection = require('./selection');
var TopicMap = require('./topicMap');
var parseSelection = selection.parse;

var ResourceIndex = function() {
    this.resources = { };
    this.indices = {
        id: { },
        interface: { },
        type: { },
        group: new TopicMap()
    };
};

ResourceIndex.prototype.getResources = function(keyType, keyValue) {
    var self = this;

    // TODO ensure compliance with expected interface in unit tests and this
    // implementation
    if(arguments.length == 0) {
        return Promise.resolve(this.resources);
    }
    else if(arguments.length == 1) {
        return new Promise(function(resolve, reject) {
            if(keyType == 'group') {
                resolve(self.indices.group.getPublishSet(keyValue));
            }
            else if(self.indices[keyType]) {
                return Promise.resolve(self.resources);
            }
            else {
                reject(new Error('Invalid key type'));
            }
        });
    }
    else {
        return new Promise(function(resolve, reject) {
            if(keyType == 'group') {
                resolve(self.indices.group.getPublishSet(keyValue));
            }
            else if(self.indices[keyType]) {
                if(self.indices[keyType][keyValue]) {
                    resolve(self.indices[keyType][keyValue]);
                }
                else {
                    resolve({ });
                }
            }
            else {
                reject(new Error('Invalid key type'));
            }
        });
    }
};

ResourceIndex.prototype.addResource = function(resource) {
    var self = this;

    return new Promise(function(resolve, reject) {
        self.resources[resource.id] = true;
        self.indices.id[resource.id] = self.indices.id[resource.id] || { }
        self.indices.id[resource.id][resource.id] = true;

        self.indices.type[resource.type] = self.indices.type[resource.type] || { }
        self.indices.type[resource.type][resource.id] = true;

        resource.interfaces.forEach(function(interfaceName) {
            self.indices.interface[interfaceName] = self.indices.interface[interfaceName] || { }
            self.indices.interface[interfaceName][resource.id] = true;
        });

        resolve();
    });
};

ResourceIndex.prototype.removeResource = function(resource) {
    var self = this;

    return new Promise(function(resolve, reject) {
        self.indices.id[resource.id] = self.indices.id[resource.id] || { }
        delete self.indices.id[resource.id][resource.id];
        delete self.indices.id[resource.id];

        self.indices.type[resource.type] = self.indices.type[resource.type] || { }
        delete self.indices.type[resource.type][resource.id];

        if(Object.keys(self.indices.type[resource.type]).length == 0) {
            delete self.indices.type[resource.type];
        }

        resource.interfaces.forEach(function(interfaceName) {
            self.indices.interface[interfaceName] = self.indices.interface[interfaceName] || { }
            delete self.indices.interface[interfaceName][resource.id];

            if(Object.keys(self.indices.interface[interfaceName]).length == 0) {
                delete self.indices.interface[interfaceName];
            }
        });

        self.indices.group.removeClient(resource.id);
        delete self.resources[resource.id];

        resolve();
    });
};

ResourceIndex.prototype.addResourceToGroup = function(resourceID, groupName) {
    var self = this;

    return new Promise(function(resolve, reject) {
        var partialPath = '';

        groupName.split('/').forEach(function(part, index) {
            partialPath += part;
            self.indices.group.addSubscription(partialPath, resourceID);
            partialPath += '/';
        });

        resolve();
    });
};

ResourceIndex.prototype.removeResourceFromGroup = function(resourceID, groupName) {
    var self = this;

    return new Promise(function(resolve, reject) {
        var partialPath = '';

        groupName.split('/').forEach(function(part, index) {
            partialPath += part;
            self.indices.group.removeSubscription(partialPath, resourceID);
            partialPath += '/';
        });
        
        resolve();
    });
};

function makeUUIDHex() {
    var uuidBuffer = new Buffer(16);

    uuid.v4(null, uuidBuffer, 0);

    return uuidBuffer.toString('hex');
}

var SubscriberRegistry = function(resourceIndex) {
    this.resourceIndex = resourceIndex;
    this.subscriberToSubscription = { };
    this.subscriptions = { };
    this.inputs = { };
};

SubscriberRegistry.prototype.subscribe = function(subscriberID, selection, event, matchEventPrefix) {
    return this._subscribe(subscriberID, selection, event, matchEventPrefix)
};

SubscriberRegistry.prototype.unsubscribe = function(subscriberID, subscriptionID) {
    return this._unsubscribe(subscriberID, subscriptionID)
};

SubscriberRegistry.prototype.subscribeAll = function(subscriberID, selection, prefix) {
    return this._subscribe(subscriberID, selection, prefix, true)
};

SubscriberRegistry.prototype.unsubscribeAll = function(subscriberID) {
    let subscriptions = new Set()
    
    if(this.subscriberToSubscription[subscriberID]) {
        for(let subscriptionID in this.subscriberToSubscription[subscriberID]) {
            subscriptions.add(this._unsubscribe(subscriberID, subscriptionID))
        }
    }
    
    return subscriptions
};

SubscriberRegistry.prototype._subscribe = function(subscriberID, selection, event, matchEventPrefix) {
    if(arguments.length == 4 && typeof event !== 'undefined') {
        var subscriptionID = makeUUIDHex();
        var parsedSelection = parseSelection(selection);
        var flatSelection = new FlatSelection(parsedSelection);
        var graph = flatSelection.getGraph();
                
        this.subscriberToSubscription[subscriberID] = this.subscriberToSubscription[subscriberID] || { }
        this.subscriberToSubscription[subscriberID][subscriptionID] = true
        this.subscriptions[subscriptionID] = { id: subscriptionID, graph: graph, event: event, prefix: matchEventPrefix, subscriberID: subscriberID }
        
        for(let sourceNodeID in graph.sources) {
            let parentNodeID = graph.sources[sourceNodeID].parent
            let inputString = graph.sources[sourceNodeID].node.toString()
            
            this.inputs[inputString] = this.inputs[inputString] || { }
            this.inputs[inputString][subscriptionID] = this.inputs[inputString][subscriptionID] || [ ]
            this.inputs[inputString][subscriptionID].push(parentNodeID)
        }
                
        return subscriptionID
    }
    else {
        throw new Error('Invalid number of arguments');
    }
};

SubscriberRegistry.prototype._unsubscribe = function(subscriberID, subscriptionID) {
    if(arguments.length == 2) {
        let subscription = null
        
        if(this.subscriberToSubscription[subscriberID]) {
            delete this.subscriberToSubscription[subscriberID][subscriptionID]
            
            if(Object.keys(this.subscriberToSubscription[subscriberID]).length == 0) {
                delete this.subscriberToSubscription[subscriberID]
            }
        }
        
        if(this.subscriptions[subscriptionID]) {
            subscription = this.subscriptions[subscriptionID]
            let graph = subscription.graph
            
            for(let sourceNodeID in graph.sources) {
                let inputString = graph.sources[sourceNodeID].node.toString()
                
                if(this.inputs[inputString]) {
                    delete this.inputs[inputString][subscriptionID]
                }
                
                if(Object.keys(this.inputs[inputString]).length == 0) {
                    delete this.inputs[inputString]
                }
            }
            
            delete this.subscriptions[subscriptionID]
        }
        
        return subscription
    }
    else {
        throw new Error('Invalid number of arguments');
    }
};

SubscriberRegistry.prototype.getInputs = function(resourceID) {
    return this.resourceIndex.getResourceProperties(resourceID).then(function(resourceProperties) {
        var inputs = [ ]

        inputs.push(new selection.StringCheckNode('id', resourceID).toString())
        inputs.push(new selection.WildcardCheckNode('id').toString())

        if(resourceProperties != null) {
            // expand groups
            var expandedGroups = { };
            
            for(var group in resourceProperties.groups) {
                group.split('/').map((subGroup, index, subGroups) => subGroups.slice(0, index+1).join('/')).forEach(function(g) {
                    expandedGroups[g] = true;
                })
            }
            
            resourceProperties.groups = expandedGroups;
            
            
            inputs.push(new selection.StringCheckNode('type', resourceProperties.type).toString())
            inputs.push(new selection.WildcardCheckNode('type').toString())
            
            for(var interfaceName of resourceProperties.interfaces) {
                inputs.push(new selection.StringCheckNode('interface', interfaceName).toString())
            }
            
            inputs.push(new selection.WildcardCheckNode('interface').toString())
            
            if(Object.keys(resourceProperties.groups).length > 0) {
                inputs.push(new selection.WildcardCheckNode('group').toString())
                
                for(var groupName in resourceProperties.groups) {
                    inputs.push(new selection.StringCheckNode('group', groupName).toString())
                }
            }
        }
        
        return inputs
    })
};

SubscriberRegistry.prototype.getSubscribers = function(resourceID, event) {
    var self = this;
    var subscribers = { };

    return this.getInputs(resourceID).then(function(inputs) {
        for(var subscription of self._getOutputs(inputs, event)) {
            subscribers[subscription.subscriberID] = true
        }
    }).then(function() {
        return subscribers
    })
};

SubscriberRegistry.prototype._getOutputs = function(inputs, event) {
    let subscriptionToInputs = new Map()
    let subscriptions = new Set()

    while(inputs.length > 0) {
        let input = inputs.shift()
        
        if(this.inputs[input]) {
            for(let subscriptionID in this.inputs[input]) {
                if(!subscriptionToInputs.has(subscriptionID)) {
                    subscriptionToInputs.set(subscriptionID, [ ])
                }
                
                let inputsQueue = subscriptionToInputs.get(subscriptionID)
                let subscription = this.subscriptions[subscriptionID]
                
                if(subscription.event == event && !subscription.prefix || event.startsWith(subscription.event) && subscription.prefix) {
                    let logic = subscription.graph.logic
                    
                    for(let parentNode of this.inputs[input][subscriptionID]) {
                        inputsQueue.push(parentNode)
                    }
                }
            }
        }
    }
    
    for(let subscriptionID of subscriptionToInputs.keys()) {
        let subscription = this.subscriptions[subscriptionID]
        let logic = subscription.graph.logic
        let inputsQueue = subscriptionToInputs.get(subscriptionID)

        if(this._getOutput(inputsQueue, logic)) {
            subscriptions.add(subscription)
        }
    }
    
    return subscriptions
};

SubscriberRegistry.prototype._getOutput = function(inputs, logic) {
    let output = false
    let andInputCounts = new Map()
    
    while(inputs.length > 0) {
        let input = inputs.shift()
        
        if(input == null) {
            output = true
        }
        else {
            let node = logic[input]
            
            if(node.type == 'and') {
                if(andInputCounts.has(input)) {
                    andInputCounts.delete(input)
                    
                    inputs.push(node.parent)
                }
                else {
                    andInputCounts.set(input, 1)
                }
            }
            else if(node.type == 'or') {
                inputs.push(node.parent)
            }
        }
    }
    
    return output
};

SubscriberRegistry.prototype.isInSelection = function(resourceID, node) {
    var self = this;

    if(node instanceof selection.AndNode) {
        return this.isInSelection(resourceID, node.getLeftOperand()).then(function(b) {
            if(b) {
                return self.isInSelection(resourceID, node.getRightOperand());
            }
            else {
                return false;
            }
        });
    }
    else if(node instanceof selection.OrNode) {
        return this.isInSelection(resourceID, node.getLeftOperand()).then(function(b) {
            if(!b) {
                return self.isInSelection(resourceID, node.getRightOperand());
            }
            else {
                return true;
            }
        });
    }
    else if(node instanceof selection.NotNode) {
        return this.isInSelection(resourceID, node.getOperand()).then(function(b) {
            return !b;
        });
    }
    else if(node instanceof selection.WildcardCheckNode) {
        return this.resourceIndex.getResources(node.getPropertyName()).then(function(resources) {
            return resources.hasOwnProperty(resourceID);
        });
    }
    else if(node instanceof selection.StringCheckNode) {
        if(node.getPropertyName() === 'id') {
            return Promise.resolve(node.getPropertyValue() == resourceID);
        }
        else {
            return this.resourceIndex.getResources(node.getPropertyName(), node.getPropertyValue()).then(function(resources) {
                return resources.hasOwnProperty(resourceID);
            });
        }
    }
};

var ResourceRegistry = function(resourceIndex) {
    this.resourceIndex = resourceIndex;
};

ResourceRegistry.prototype.getSelection = function(selection) {
    try {
        return this.evaluateSelection(parseSelection(selection));
    }
    catch(error) {
        return Promise.reject(error);
    }
};

ResourceRegistry.prototype.evaluateSelection = function(node) {
    function intersection(set1, set2) {
        return Promise.all([set1, set2]).then(function(sets) {
            var result = { };

            Object.keys(sets[0]).forEach(function(resourceID) {
                if(sets[1][resourceID]) {
                    result[resourceID] = true;
                }
            });

            return result;
        });
    }

    function union(set1, set2) {
        return Promise.all([set1, set2]).then(function(sets) {
            var result = { };

            Object.keys(sets[0]).forEach(function(resourceID) {
                result[resourceID] = true;
            });

            Object.keys(sets[1]).forEach(function(resourceID) {
                result[resourceID] = true;
            });

            return result;
        });
    }

    function difference(set1, set2) {
        return Promise.all([set1, set2]).then(function(sets) {
            var result = { };

            Object.keys(sets[0]).forEach(function(resourceID) {
                if(!sets[1][resourceID]) {
                    result[resourceID] = true;
                }
            });

            return result;
        });
    }

    if(node instanceof selection.AndNode) {
        // and -> intersect
        return intersection(this.evaluateSelection(node.getLeftOperand()), this.evaluateSelection(node.getRightOperand()));
    }
    else if(node instanceof selection.OrNode) {
        // and -> union
        return union(this.evaluateSelection(node.getLeftOperand()), this.evaluateSelection(node.getRightOperand()));
    }
    else if(node instanceof selection.NotNode) {
        // not -> complement
        return difference(this.resourceIndex.getResources(), this.evaluateSelection(node.getOperand()));
    }
    else if(node instanceof selection.WildcardCheckNode) {
        return this.resourceIndex.getResources(node.getPropertyName());
    }
    else if(node instanceof selection.StringCheckNode) {
        return this.resourceIndex.getResources(node.getPropertyName(), node.getPropertyValue());
    }
};

class FlatSelection {
    constructor(parsedSelection) {
        this.inputs = { }
        this.nodes = { }
        
        this._buildKVMap(parsedSelection)
    }
    
    getGraph() {
        return {
            sources: this.inputs,
            logic: this.nodes
        }
    }
    
    _toGraph(parsedSelection) {
        let nextVertexID = 1
        let nodeQueue = [ parsedSelection ]
        let vertexMap = new Map()
        let edgeMap = new Map()
        let sourceSet = new Set()
        
        vertexMap.set(0, parsedSelection)
        edgeMap.set(0, null)
        
        while(nodeQueue.length > 0) {
            let nextNode = nodeQueue.shift()
            let parentVertexID = nextVertexID-1
           
            if(nextNode.getChildren().length == 0) {
                sourceSet.add(parentVertexID)
            }
            else {
                for(let childNode of nextNode.getChildren()) {
                    let childVertexID = nextVertexID++
                    
                    vertexMap.set(nextVertexID, childNode)
                    edgeMap.set(childVertexID, parentVertexID)
                    
                    nodeQueue.push(childNode)
                }
            }
        }
        
        return { sourceSet, vertexMap, edgeMap }
    }
    
    _buildKVMap(parsedSelection) {
        let reverseGraph = this._toGraph(parsedSelection)
        let vertexMap = reverseGraph.vertexMap
        let edgeMap = reverseGraph.edgeMap
        let sourceSet = reverseGraph.sourceSet
        
        for(let sourceVertex of sourceSet) {
            this.inputs[sourceVertex] = { node: vertexMap.get(sourceVertex), parent: edgeMap.get(sourceVertex) }
        }
        
        for(let vertex of vertexMap.keys()) {
            if(!this.inputs[vertex]) {
                let nodeType
                
                if(vertexMap.get(vertex) instanceof selection.AndNode) {
                    nodeType = 'and'
                }
                else if(vertexMap.get(vertex) instanceof selection.OrNode) {
                    nodeType = 'or'
                }
                else if(vertexMap.get(vertex) instanceof selection.NotNode) {
                    throw new Error('not node')
                }
                
                this.nodes[vertex] = { type: nodeType, parent: edgeMap.get(vertex) }
            }
        }
    }
}

module.exports = {
    ResourceRegistry: ResourceRegistry,
    SubscriberRegistry: SubscriberRegistry,
    ResourceIndex: ResourceIndex,
    FlatSelection: FlatSelection
};
