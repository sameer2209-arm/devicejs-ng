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

const request = require('request')
const https = require('https')
const EventEmitter = require('events').EventEmitter
const url = require('url')

const T_FAIL_DEFAULT = 30000
const N_GOSSIP_DEFAULT = 1
const T_GOSSIP_DEFAULT = 1000

class NodeMonitor extends EventEmitter {
    constructor(nodeID, app, options, cloudTunnel) {
        super()

        let self = this

        this.nodeID = nodeID
        this.cloudTunnel = cloudTunnel
        this.heartbeatMap = new Map([ [ nodeID, { count: 0 } ] ])
        this.gossipPeers = new Map()
        this.tFail = options.tFail || T_FAIL_DEFAULT
        this.nGossip = options.nGossip || N_GOSSIP_DEFAULT
        this.tGossip = options.tGossip || T_GOSSIP_DEFAULT
        this.requireAuthentication = options.requireAuthentication
        this.https = options.https
        this.authClient = options.authClient

        if(this.cloudTunnel) {
            this.cloudTunnel.on('heartbeat', function(heartbeat) {
                let heartbeatMap = heartbeat.heartbeatMap

                self.mergeHeartbeatMap('cloud', heartbeatMap)
            })
        }

        app.post('/heartbeat', function(req, res) {
            let sourceNodeID = req.body.nodeID
            let heartbeatMap = req.body.heartbeatMap

            if(self.heartbeatMap.has(sourceNodeID)) {
                self.heartbeatMap.get(sourceNodeID).time = new Date().getTime()
            }

            self.mergeHeartbeatMap(sourceNodeID, heartbeatMap)
        })
    }

    start() {
        let self = this

        this.heartbeatInterval = setInterval(function() {
            let heartbeatMap = { }

            self.heartbeatMap.get(self.nodeID).count += 1

            for(let nodeID of self.heartbeatMap.keys()) {
                heartbeatMap[nodeID] = self.heartbeatMap.get(nodeID).count
            }

            let elementIndex = parseInt(Math.random()*self.gossipPeers.size)
            let addresses = [ ]

            for(let nodeID of self.gossipPeers.keys()) {
                addresses.push({ nodeID: nodeID, address: self.gossipPeers.get(nodeID) })
            }

            function _newRequestOptions(options, nodeID) {
                let postOptions = { }

                if(self.https) {
                    for(let k in self.https) {
                        postOptions[k] = self.https[k]
                    }
                }

                if(self.requireAuthentication) {
                    postOptions.agentOptions = {
                        checkServerIdentity: function(servername, cert) {
                            let serverIdentity = cert.subject.CN

                            /*self.authClient.getIdentityInfo(serverIdentity).then(function(identityInfo) {

                            }, function(error) {
                                // shouldn't ping this server anymore
                                self.gossipPeers.delete(nodeID)
                            })*/
                        }
                    }
                }
                else {
                    postOptions.agentOptions = {
                        checkServerIdentity: function(servername, cert) {
                        }
                    }
                }

                for(let k in options) {
                    postOptions[k] = options[k]
                }

                return postOptions
            }

            // send to one reachable neighbor
            for(let i = 0; i < addresses.length; i += 1) {
                let nodeID = addresses[(i+elementIndex) % addresses.length].nodeID
                let address = addresses[(i+elementIndex) % addresses.length].address

                if(self.isReachable(nodeID)) {
                    request.post(address+'/heartbeat', _newRequestOptions({
                        body: {
                            nodeID: self.nodeID,
                            heartbeatMap: heartbeatMap
                        },
                        json: true
                    })).on('error', function(error) {
                        self.heartbeatMap.get(nodeID).time = new Date().getTime() - self.tFail

                        self.emit('link down', nodeID)
                    })

                    break
                }
            }

            // try to send to one unreachable neighbor
            for(let i = 0; i < addresses.length; i += 1) {
                let nodeID = addresses[(i+elementIndex) % addresses.length].nodeID
                let address = addresses[(i+elementIndex) % addresses.length].address

                if(!self.heartbeatMap.has(nodeID) || !self.isReachable(nodeID)) {
                    request.post(address+'/heartbeat', _newRequestOptions({
                        body: {
                            nodeID: self.nodeID,
                            heartbeatMap: heartbeatMap
                        },
                        json: true
                    }), function(error, response, responseBody) {
                        if(!error) {
                            if(!self.heartbeatMap.has(nodeID)) {
                                return
                            }
                            
                            self.heartbeatMap.get(nodeID).time = new Date().getTime()

                            self.emit('link up', nodeID)
                        }
                    }).on('error', function() { })

                    break
                }
            }
        }, this.tGossip)
    }

    stop() {
        clearInterval(this.heartbeatInterval)
    }

    addPeer(nodeID, peerAddress) {
        let protocol = url.parse(peerAddress).protocol

        if(this.requireAuthentication && protocol == 'http:') {
            return
        }

        this.gossipPeers.set(nodeID, peerAddress)
    }

    hasPeer(nodeID) {
        return this.gossipPeers.has(nodeID)
    }

    getPeerAddress(nodeID) {
        if(this.hasPeer(nodeID)) {
            return this.gossipPeers.get(nodeID)
        }
        else {
            return null
        }
    }

    mergeHeartbeatMap(sourceNodeID, heartbeatMap) {
        for(let nodeID in heartbeatMap) {
            if(nodeID == this.nodeID) {
                this.heartbeatMap.get(this.nodeID).count = Math.max(this.heartbeatMap.get(this.nodeID).count, heartbeatMap[nodeID])
            }
            else {
                this.heartbeatFrom(nodeID, heartbeatMap[nodeID])
            }
        }
    }

    heartbeatFrom(sourceNodeID, theirHeartbeat) {
        if(this.heartbeatMap.has(sourceNodeID)) {
            let myHeartbeat = this.heartbeatMap.get(sourceNodeID).count

            if(theirHeartbeat > myHeartbeat) {
                this.heartbeatMap.set(sourceNodeID, { count: theirHeartbeat, time: new Date().getTime() })
            }
        }
        else {
            this.heartbeatMap.set(sourceNodeID, { count: theirHeartbeat, time: new Date().getTime() })
        }
    }

    getReachabilityMap() {
        let reachabilityMap = { }

        for(let nodeID of this.heartbeatMap.keys()) {
            reachabilityMap[nodeID] = this.isReachable(nodeID)
        }

        reachabilityMap.cloud = this.isReachable('cloud')

        return reachabilityMap
    }

    getNeighbors() {
        let neighbors = new Set()

        for(let neighborID of this.gossipPeers.keys()) {
            neighbors.add(neighborID)
        }

        return neighbors
    }

    isReachable(nodeID) {
        if(nodeID == this.nodeID) {
            return true
        }
        else if(nodeID == 'cloud' && this.cloudTunnel) {
            return this.cloudTunnel.isConnected()
        }
        else if(this.heartbeatMap.has(nodeID)) {
            let currentTime = new Date().getTime()
            let lastHeartbeatTime = this.heartbeatMap.get(nodeID).time

            return (currentTime - lastHeartbeatTime) < this.tFail
        }
        else {
            return false
        }
    }
}

module.exports = {
    NodeMonitor: NodeMonitor
}
