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


const ddb = require('../runtime/devicedb')({ })
const AsyncLockMap = require('./asyncLockMap').AsyncLockMap
const AsyncRWLock = require('./asyncLockMap').AsyncRWLock

const BY_NODE_PREFIX = 'devicejs.core.reachability.bynode.'
const BY_RESOURCE_PREFIX = 'devicejs.core.reachability.byresource.'
const RESYNC_INTERVAL_MS = 5000

let indexedByNode = (nodeID, resourceID) => {
    return BY_NODE_PREFIX + ddb.encodeKey(nodeID) + '.' + ddb.encodeKey(resourceID)
}

let indexedByResource = (nodeID, resourceID) => {
    return BY_RESOURCE_PREFIX + ddb.encodeKey(resourceID) + '.' + ddb.encodeKey(nodeID)
}

class ReachabilityMap {
    constructor(nodeID, ddb) {
        this.resyncLock = new AsyncRWLock()
        this.asyncLockMap = new AsyncLockMap()
        this.ddb = ddb
        this.nodeID = nodeID
        this.pendingReachabilityUpdateMap = { }
    }

    _resyncOnConnect() {
        if(this.resyncInterval) {
            return
        }

        this.resyncInterval = setInterval(() => {
            if(this.resyncLockPending) {
                return
            }

            this.resyncLockPending = true

            this.resyncLock.wlock().then(() => {
                let batch = [ ]
                
                for(let resourceID in this.pendingReachabilityUpdateMap) {
                    let ops

                    if(this.pendingReachabilityUpdateMap[resourceID]) {
                        ops = this._markAsReachable(resourceID)
                    }
                    else {
                        ops = this._markAsUnreachable(resourceID)
                    }

                    for(let op of ops) {
                        batch.push(op)
                    }
                }

                this.ddb.lww.batch(batch).then(() => {
                    this.resyncLockPending = false

                    clearInterval(this.resyncInterval)

                    this.resyncLock.wunlock()
                }, (error) => {
                    this.resyncLockPending = false
                    
                    this.resyncLock.wunlock()
                })
            })            
        }, RESYNC_INTERVAL_MS)
    }

    _markAsReachable(resourceID) {
        return [
            {
                type: 'put',
                key: indexedByNode(this.nodeID, resourceID),
                value: 'true',
                context: ''
            },
            {
                type: 'put',
                key: indexedByResource(this.nodeID, resourceID),
                value: 'true',
                context: ''
            }
        ]
    }

    _markAsUnreachable(resourceID) {
        return [
            {
                type: 'delete',
                key: indexedByNode(this.nodeID, resourceID),
                context: ''
            },
            {
                type: 'delete',
                key: indexedByResource(this.nodeID, resourceID),
                context: ''
            }
        ]
    }

    markAsReachable(resourceID) {
        let batch = this._markAsReachable(resourceID)

        return this.resyncLock.rlock().then(() => {
            return this.asyncLockMap.acquire(resourceID)
        }).then(() => {
            return this.ddb.lww.batch(batch).then(() => {
                delete this.pendingReachabilityUpdateMap[resourceID]
                
                this.asyncLockMap.release(resourceID)
                this.resyncLock.runlock()
            }, (error) => {
                this.pendingReachabilityUpdateMap[resourceID] = true
                this._resyncOnConnect()

                this.asyncLockMap.release(resourceID)
                this.resyncLock.runlock()
            })
        })
    }

    markAsUnreachable(resourceID) {
        let batch = this._markAsUnreachable(resourceID)

        return this.resyncLock.rlock().then(() => {
            return this.asyncLockMap.acquire(resourceID)
        }).then(() => {
            return this.ddb.lww.batch(batch).then(() => {
                delete this.pendingReachabilityUpdateMap[resourceID]

                this.asyncLockMap.release(resourceID)
                this.resyncLock.runlock()
            }, (error) => {
                this.pendingReachabilityUpdateMap[resourceID] = false
                this._resyncOnConnect()
                
                this.asyncLockMap.release(resourceID)
                this.resyncLock.runlock()                
            })
        })
    }

    getReachability(resources) {
        let reachability = { }
        let keys = resources.map(resourceID => BY_RESOURCE_PREFIX + ddb.encodeKey(resourceID) + '.')

        for(let resourceID of resources) {
            reachability[resourceID] = [ ]
        }
        
        return this.ddb.lww.getMatches(keys, (error, result) => {
            if(error) {
                return
            }

            let resourceID = ddb.decodeKey(result.key.substring(BY_RESOURCE_PREFIX, result.prefix.length))
            let nodeID = ddb.decodeKey(result.key.substring(result.prefix.length))

            if(resourceID in reachability) {
                reachability[resourceID].push(nodeID)
            }
        }).then(() => {
            return reachability
        })
    }

    clear() {
        // Call on startup. Ensure it is only called once and not concurrently with any other methods
        let batch = [ ]
        let resources = [ ]

        this.pendingReachabilityUpdateMap = { }

        return new Promise((resolve, reject) => {
            let _clear = () => {
                return this.ddb.lww.getMatches(BY_NODE_PREFIX + ddb.encodeKey(this.nodeID) + '.', (error, result) => {
                    if(error) {
                        return
                    }

                    let resourceID = ddb.decodeKey(result.key.substring(result.prefix.length))

                    batch.push({
                        type: 'delete',
                        key: result.key,
                        context: ''
                    })

                    batch.push({
                        type: 'delete',
                        key: indexedByResource(this.nodeID, resourceID),
                        context: ''
                    })
                }).then(() => {
                    return this.ddb.lww.batch(batch)
                }).then(() => {
                    resolve()
                }, (error) => {
                    setTimeout(() => {
                        _clear()
                    }, RESYNC_INTERVAL_MS)
                })
            }

            _clear()
        })
    }
}

module.exports = ReachabilityMap