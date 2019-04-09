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

const Heap = require('heap')

const T_FAIL_DEFAULT = 30000
const N_GOSSIP_DEFAULT = 1
const T_GOSSIP_DEFAULT = 1000

class LinkStateTable {
    constructor(nodeID) {
        if(typeof nodeID === 'string') {
            this.nodeID = nodeID 
            this.linkStateTable = new Map([ [ nodeID, { neighbors: new Set(), sequenceNumber: 0 } ] ])
        }
        else {
            this.linkStateTable = nodeID
        }
    }
    
    linkUp(neighborID) {
        this.linkStateTable.get(this.nodeID).neighbors.add(neighborID)
        this.linkStateTable.get(this.nodeID).sequenceNumber += 1
    }
    
    linkDown(neighborID) {
        this.linkStateTable.get(this.nodeID).neighbors.delete(neighborID)
        this.linkStateTable.get(this.nodeID).sequenceNumber += 1
    }
    
    merge(diffTable) {
        let changeTable = new Map()
        
        for(let nodeID of diffTable.linkStateTable.keys()) {
            if(!this.linkStateTable.has(nodeID) ||
               this.linkStateTable.get(nodeID).sequenceNumber < diffTable.linkStateTable.get(nodeID).sequenceNumber) {
                this.linkStateTable.set(nodeID, diffTable.linkStateTable.get(nodeID))
                this.linkStateTable.get(nodeID).timestamp = new Date().getTime()
                
                changeTable.set(nodeID, { neighbors: this.linkStateTable.get(nodeID).neighbors, sequenceNumber: this.linkStateTable.get(nodeID).sequenceNumber })
            }
        }
        
        return new LinkStateTable(changeTable)
    }
    
    diff(theirDigest) {
        let diffTable = new Map()
        
        // which changes has the other link state table not seen that we have
        for(let nodeID in theirDigest) {
            let theirSequenceNumber = theirDigest[nodeID]
            
            if(this.linkStateTable.has(nodeID) && this.linkStateTable.get(nodeID).sequenceNumber > theirSequenceNumber) {
                diffTable.set(nodeID, this.linkStateTable.get(nodeID))
            }
        }
        
        for(let nodeID of this.linkStateTable.keys()) {
            if(!theirDigest.hasOwnProperty(nodeID)) {
                diffTable.set(nodeID, this.linkStateTable.get(nodeID))
            }
        }
                
        return new LinkStateTable(diffTable)
    }
    
    getDigest() {
        let digest = { }
        
        for(let nodeID of this.linkStateTable.keys()) {
            digest[nodeID] = this.linkStateTable.get(nodeID).sequenceNumber
        }
        
        return digest
    }
    
    getLinkStateMap() {
        let linkStateMap = new Map()
        
        for(let nodeID of this.linkStateTable.keys()) {
            linkStateMap.set(nodeID, this.linkStateTable.get(nodeID).neighbors)
        }
        
        return linkStateMap
    }
    
    getShortestPathTree() {
        let distance = new Map()
        let previous = new Map()
        let vertexHeap = new Heap((a, b) => distance.get(a) == distance.get(b) ? 0 : distance.get(a) - distance.get(b))
        let reversedTree = new Map()
        
        for(let nodeID of this.linkStateTable.keys()) {
            if(nodeID !== this.nodeID) {
                distance.set(nodeID, Infinity)
            }
            else {
                distance.set(nodeID, 0)
            }
            
            previous.set(nodeID, null)
            vertexHeap.push(nodeID)
        }
        
        while(vertexHeap.size() != 0) {
            let minNodeID = vertexHeap.pop()
            
            for(let neighborID of this.linkStateTable.get(minNodeID).neighbors) {
                if(distance.get(minNodeID) + 1 < distance.get(neighborID)) {
                    distance.set(neighborID, distance.get(minNodeID) + 1)
                    previous.set(neighborID, minNodeID)
                    
                    vertexHeap.updateItem(neighborID)
                }
            }
        }
        
        for(let nodeID of previous.keys()) {
            let parentNodeID = previous.get(nodeID)
            
            if(parentNodeID != null) {
                if(!reversedTree.has(parentNodeID)) {
                    reversedTree.set(parentNodeID, new Set())
                }
                
                reversedTree.get(parentNodeID).add(nodeID)
            }
        }
        
        return reversedTree
    }
    
    updateRoutingTable(routingTable) {
        routingTable.clear()
        
        let shortestPathTree = this.getShortestPathTree()
        let nodeQueue = [ this.nodeID ]

        while(nodeQueue.length > 0) {
            let parentNodeID = nodeQueue.shift()
            
            if(shortestPathTree.has(parentNodeID)) {
                let childrenNodeIDs = shortestPathTree.get(parentNodeID)

                for(let childNodeID of childrenNodeIDs) {
                    if(!routingTable.has(parentNodeID)) {
                        routingTable.set(childNodeID, childNodeID)
                    }
                    else {
                        routingTable.set(childNodeID, routingTable.get(parentNodeID))
                    }
                    
                    nodeQueue.push(childNodeID)
                }
            }
        }
    }
    
    static serialize(lst) {
        let json = { linkStateTable: { } }
        
        if(lst.nodeID) {
            json.nodeID = lst.nodeID
        }
        
        for(let nodeID of lst.linkStateTable.keys()) {
            let neighborEntry = lst.linkStateTable.get(nodeID)
            let entry = { 
                sequenceNumber: neighborEntry.sequenceNumber,
                neighbors: [ ]
            }
            
            if(neighborEntry.timestamp) {
                entry.timestamp = neighborEntry.timestamp
            }
            
            for(let neighborID of neighborEntry.neighbors) {
                entry.neighbors.push(neighborID)
            }
            
            json.linkStateTable[nodeID] = entry
        }
        
        return JSON.stringify(json)
    }
    
    static deserialize(lst) {
        let json = JSON.parse(lst)
        let linkStateTable = new LinkStateTable(new Map())
        
        if(json.nodeID) {
            linkStateTable.nodeID = json.nodeID
        }
        
        for(let nodeID in json.linkStateTable) {
            let newEntry = {
                sequenceNumber: json.linkStateTable[nodeID].sequenceNumber,
                neighbors: new Set(json.linkStateTable[nodeID].neighbors)
            }
            
            if(json.linkStateTable[nodeID].timestamp) {
                newEntry.timestamp = json.linkStateTable[nodeID].timestamp
            }
            
            linkStateTable.linkStateTable.set(nodeID, newEntry)
        }
        
        return linkStateTable
    }
}

class NodeRouter {
    constructor(linkStateTable, routingTable, nodeMonitor, options, cloudTunnel) {
        let self = this
        
        this.linkStateTable = linkStateTable
        this.nodeMonitor = nodeMonitor
        this.routingTable = routingTable
        this.requireAuthentication = options.requireAuthentication
        this.https = options.https
        this.authClient = options.authClient
        
        app.post('/diff', function(req, res) {
            let sourceNodeID = req.body.nodeID
            let digest = req.body.digest
            let diffTable = self.linkStateTable.diff(digest)
            
            res.status(200).send({
                diffTable: LinkStateTable.serialize(diffTable)
            })
        })
        
        app.post('/routeChanges', function(req, res) {
            let sourceNodeID = req.body.nodeID
            let changesTable = LinkStateTable.deserialize(req.body.changesTable)
            
            self.broadcastRouteChanges(changesTable.merge(changesTable), sourceNodeID)
            
            res.status(200).send()
        })
    }
    
    broadcastRouteChanges(changesTable, exceptNodeID) {
        let self = this
        let promises = [ ]
        let serializedChangesTable = LinkStateTable.serialize(changesTable)
        
        for(let nodeID of this.nodeMonitor.getNeighbors()) {
            if(nodeID != exceptNodeID && this.nodeMonitor.isReachable(nodeID)) {
                promises.push(new Promise(function(resolve, reject) {
                    request.post(address+'/routeChanges', _newRequestOptions({
                        body: {
                            nodeID: self.nodeID,
                            changesTable: serializedChangesTable
                        },
                        json: true
                    }), function(error, response, responseBody) {
                        if(error) {
                            reject(error)
                        }
                        else if(response.statusCode != 200) {
                            reject({ status: response.statusCode, response: responseBody })
                        }
                        else {
                            resolve()
                        }
                    })
                }))
            }
        }
        
        return Promise.all(promises)
    }
    
    start() {
        let self = this
        
        this.nodeMonitor.on('link up', function(nodeID) {
            self.linkStateTable.linkUp(nodeID)
            
            syncWith(nodeID).then(function(changesTable) {
                self.broadcastRouteChanges(changesTable, nodeID)
                
                recalculateShortestPaths()
            })
        }).on('link down', function(nodeID) {
            self.linkStateTable.linkDown(nodeID)
            
            let myLinkState = self.linkStateMap.getLinkStateMap().get(self.nodeID)
            let changesTable = new LinkStateTable(new Map([ [ self.nodeID, myLinkState ] ]))
            
            self.broadcastRouteChanges(changesTable)
            
            recalculateShortestPaths()
        })
        
        function recalculateShortestPaths() {
            self.linkStateTable.updateRoutingTable(self.routingTable)
        }
        
        function syncWith(nodeID) {
            let neighborAddress = self.nodeMonitor.getPeerAddress(nodeID)
            
            return new Promise(function(resolve, reject) {
                request.post(address+'/diff', _newRequestOptions({
                    body: {
                        nodeID: self.nodeID,
                        digest: self.linkStateTable.getDigest()
                    },
                    json: true
                }), function(error, response, responseBody) {
                    if(error) {
                        reject(error)
                    }
                    else if(response.statusCode != 200) {
                        reject({ status: response.statusCode, response: responseBody })
                    }
                    else {
                        let diffTable = LinkStateTable.deserialize(responseBody.diffTable)
                        let changesTable = self.linkStateTable.merge(diffTable)
                        
                        resolve(changesTable)
                    }
                })
            })
        }
                
        function _newRequestOptions(options) {
            let postOptions = { }
        
            if(self.https) {
                for(let k in self.https) {
                    postOptions[k] = self.https[k]
                }
            }
            
            if(self.requireAuthentication) {
                postOptions.agent = new https.Agent({
                    checkServerIdentity: function(servername, cert) {
                        let serverIdentity = cert.subject.CN
                        
                        self.authClient.getIdentityInfo(serverIdentity).then(function(identityInfo) {
                            
                        }, function(error) {
                            // TODO this neighbor has become unreachable
                        })
                    }
                })
            }
            
            for(let k in options) {
                postOptions[k] = options[k]
            }
            
            return postOptions
        }
    }
    
    stop() {
        clearInterval(this.routeInterval)
    }
}

module.exports = {
    NodeRouter: NodeRouter,
    LinkStateTable: LinkStateTable
}
