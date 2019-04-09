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

const registry = require('./registry')
const selection = require('./selection')
const parseSelection = selection.parse
const ddb = require('../runtime/devicedb')({ })
const AsyncLockMap = require('./asyncLockMap').AsyncLockMap
const FlatSelection = registry.FlatSelection
const LRU = require('lru-cache')

const SUBSCRIBER_REGISTRY_KEY_PREFIX = 'devicejs.core.subscriberRegistry'
const SUBSCRIPTION_INPUTS_PREFIX = 'devicejs.core.subscriptionInputs'
const SUBSCRIPTION_LOGIC_PREFIX = 'devicejs.core.subscriptionLogic'
const DEFAULT_CACHE_SIZE = 1000
const DEFAULT_CACHE_TTL = 60*1000*10 // 10 minutes

class DDBSubscriberRegistry extends registry.SubscriberRegistry {
    constructor(serverID, ddb, resourceIndex) {
        super(resourceIndex)
        
        this.keyLockMap = new AsyncLockMap()
        this.serverID = serverID
        this._ddb = ddb
        this._cache = LRU({ max: DEFAULT_CACHE_SIZE, maxAge: DEFAULT_CACHE_TTL })
    }
    
    gc() {
        return Promise.resolve()
    }
    
    subscribe(subscriberID, selection, event, matchEventPrefix) {
        let self = this
        let subscriptionID = super.subscribe(subscriberID, selection, event, !!matchEventPrefix)
        let graph = this.subscriptions[subscriptionID].graph
        let updates = [ ]
        
        // make sure there is a record in the subscription log
        updates.push({ type: 'put', key: SUBSCRIBER_REGISTRY_KEY_PREFIX+'.'+ddb.encodeKey(this.serverID)+'.'+ddb.encodeKey(subscriptionID), value: JSON.stringify({ graph: graph, event: event, prefix: !!matchEventPrefix }), context: '' })
        
        // record inputs
        for(let sourceNodeID in graph.sources) {
            let inputString = graph.sources[sourceNodeID].node.toString()
            let parentNodeID = graph.sources[sourceNodeID].parent
            
            updates.push({ type: 'put', key: SUBSCRIPTION_INPUTS_PREFIX+'.'+ddb.encodeKey(inputString)+'.'+ddb.encodeKey(subscriptionID), value: JSON.stringify({ serverID: this.serverID, parent: parentNodeID }), context: '' })
        }
                
        return this.keyLockMap.acquire(subscriptionID).then(function() {
            // make sure that the log gets recorded first. if this doesn't happen successfully,
            // the whole operation should be aborted. It should never be the case where the 
            // logic and inputs are written before the log entry. The property must hold that
            // the logic and inputs exist if and only if the log entry exists. If this doesn't hold
            // a parallel unsubscribe can cause inconsistent data and garbage that is not able to be
            // cleaned up
            return self._ddb.lww.batch(updates.slice(0, 1)).then(function() {
                return self._ddb.lww.batch(updates.slice(1))
            })
        }).then(function() {
            self.keyLockMap.release(subscriptionID)
            return subscriptionID
        }, function(error) {
            self.keyLockMap.release(subscriptionID)
            throw error
        })
    }
    
    unsubscribe(subscriberID, subscriptionID) {
        let subscription = super.unsubscribe(subscriberID, subscriptionID)
        
        if(subscription != null) {
            let graph = subscription.graph
            let self = this
            let updates = [ ]
            
            // make sure there is a record in the subscription log
            updates.push({ type: 'delete', key: SUBSCRIBER_REGISTRY_KEY_PREFIX+'.'+ddb.encodeKey(this.serverID)+'.'+ddb.encodeKey(subscriptionID), context: '' })
            
            // record inputs
            for(let sourceNodeID in graph.sources) {
                let inputString = graph.sources[sourceNodeID].node.toString()
                
                updates.push({ type: 'delete', key: SUBSCRIPTION_INPUTS_PREFIX+'.'+ddb.encodeKey(inputString)+'.'+ddb.encodeKey(subscriptionID), context: '' })
            }
            
            return this.keyLockMap.acquire(subscriptionID).then(function() {
                // make sure that the log gets deleted last
                return self._ddb.lww.batch(updates.slice(1)).then(function() {
                    return self._ddb.lww.batch(updates.slice(0, 1))
                })
            }).then(function() {
                self.keyLockMap.release(subscriptionID)
                return selection
            }, function(error) {
                self.keyLockMap.release(subscriptionID)
                throw error
            })
        }
        else {
            return Promise.resolve()
        }
    }
    
    subscribeAll(subscriberID, selection, prefix) {
        return this.subscribe(subscriberID, selection, prefix, true)
    }
    
    unsubscribeAll(subscriberID) {
        let self = this
        let subscriptions = super.unsubscribeAll(subscriberID)
        let subscriptionArray = [ ]
        let logUpdates = [ ]
        let inputUpdates = [ ]
        
        for(let subscription of subscriptions) {
            let graph = subscription.graph
            let subscriptionID = subscription.id
            
            subscriptionArray.push(subscription)
            
            logUpdates.push({ type: 'delete', key: SUBSCRIBER_REGISTRY_KEY_PREFIX+'.'+ddb.encodeKey(this.serverID)+'.'+ddb.encodeKey(subscriptionID), context: '' })
            
            for(let sourceNodeID in graph.sources) {
                let inputString = graph.sources[sourceNodeID].node.toString()
                
                inputUpdates.push({ type: 'delete', key: SUBSCRIPTION_INPUTS_PREFIX+'.'+ddb.encodeKey(inputString)+'.'+ddb.encodeKey(subscriptionID), context: '' })
            }
        }
        
        return Promise.all(subscriptionArray.map(s => this.keyLockMap.acquire(s.id))).then(function() {
            return self._ddb.lww.batch(inputUpdates).then(function() {
                return self._ddb.lww.batch(logUpdates)
            })
        }).then(function() {
            subscriptionArray.map(s => self.keyLockMap.release(s.id))
        }, function(error) {
            subscriptionArray.map(s => self.keyLockMap.release(s.id))
            throw error
        })
    }
    
    getSubscribers(resourceID, event) {
        let subscribers = super.getSubscribers(resourceID, event)
        
        return subscribers
    }
    
    getRemoteSubscribers(resourceID, event) {
        let self = this
        let ddbImport = ddb
        let cached = this._cache.get(resourceID+'-'+event)
        
        if(cached) {
            return Promise.resolve(cached)
        }
        
        function readInput(ddb, thisServerID, inputString, inputsToSubscriptions) {
            function next(error, result) {
                let subscriptionID = ddbImport.decodeKey(result.key.substring(result.prefix.length))
                
                try {
                    let parsedValue = JSON.parse(result.value)
                    let serverID = parsedValue.serverID
                    let parentNodeID = parsedValue.parent
                    
                    if(serverID != thisServerID) {
                        if(!inputsToSubscriptions.has(inputString)) {
                            inputsToSubscriptions.set(inputString, [ ])
                        }
                        
                        inputsToSubscriptions.get(inputString).push({ serverID: serverID, subscriptionID: subscriptionID, parentNodeID: parentNodeID })
                    }
                }
                catch(error) {
                    // parse error
                }
            }
            
            return ddb.lww.getMatches(SUBSCRIPTION_INPUTS_PREFIX+'.'+ddbImport.encodeKey(inputString)+'.', next)
        }
        
        let inputsToSubscriptionsInput = new Map()

        return this.getInputs(resourceID).then(function(inputs) {
            return Promise.all(inputs.map(inputString => readInput(self._ddb, self.serverID, inputString, inputsToSubscriptionsInput)))
        }).then(function() {
            let subscriptionsList = [ ]
            let subscriptionToInputs = new Map()
            
            for(let inputString of inputsToSubscriptionsInput.keys()) {
                for(let input of inputsToSubscriptionsInput.get(inputString)) {
                    subscriptionsList.push({ serverID: input.serverID, subscriptionID: input.subscriptionID, parentNodeID: input.parentNodeID })
                    
                    if(!subscriptionToInputs.has(input.subscriptionID)) {
                        subscriptionToInputs.set(input.subscriptionID, [ ])
                    }
                    
                    subscriptionToInputs.get(input.subscriptionID).push(input.parentNodeID)
                }
            }
            
            let keys = subscriptionsList.map(s => SUBSCRIBER_REGISTRY_KEY_PREFIX+'.'+ddb.encodeKey(s.serverID)+'.'+ddb.encodeKey(s.subscriptionID))
            let subscribers = { }
            
            return self._ddb.lww.get(keys).then(function(results) {
                for(let i = 0; i < subscriptionsList.length; i += 1) {
                    let serverID = subscriptionsList[i].serverID
                    let subscriptionID = subscriptionsList[i].subscriptionID
                    let result = results[i]
                    
                    if(result != null && !(result instanceof Error) && result.value != null) {
                        try {
                            let subscription = JSON.parse(result.value)
                            
                            if(subscription.event == event && !subscription.prefix || event.startsWith(subscription.event) && subscription.prefix) {
                                let logic = subscription.graph.logic
                                let inputsQueue = subscriptionToInputs.get(subscriptionID)
                                
                                if(self._getOutput(inputsQueue, logic)) {
                                    subscribers[serverID] = true
                                }
                            }
                        }
                        catch(error) {
                            
                        }
                    }
                }
            }).then(function() {
                self._cache.set(resourceID+'-'+event, subscribers)
                
                return subscribers
            })
        })
    }
}

module.exports = DDBSubscriberRegistry
