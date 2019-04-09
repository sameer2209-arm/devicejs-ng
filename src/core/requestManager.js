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

const url = require('url')
const EventEmitter = require('events').EventEmitter
const requestLib = require('request')

class ForwardingManager extends EventEmitter {
    constructor(nodeID, app, options, cloudTunnel) {
        super()
        
        let self = this
        
        this.nodeID = nodeID
        this.cloudTunnel = cloudTunnel
        this.app = app
        this.options = options
        this.nextRequestID = 0
        this.responsePromises = { }
        
        if(this.cloudTunnel) {
            this.cloudTunnel.on('forwardRequest', function(request) {
                let requestID = request.id
                let responder = self._newResponder(function(status, responseBody) {
                    let response = {
                        id: requestID,
                        status: status,
                        response: responseBody
                    }
                    
                    self.cloudTunnel.sendMessage('forwardRequestResponse', response)
                })
                
                self.emit('request', 'cloud', request.request, request.resources, responder)
            }).on('forwardEvent', function(event) {
                self.emit('event', 'cloud', event)
            }).on('forwardRequestResponse', function(response) {
                if(self.responsePromises[response.id]) {
                    self.responsePromises[response.id].resolve(response.response)
                    delete self.responsePromises[response.id]
                }
            }).on('disconnect', function() {
                for(let requestID in self.responsePromises) {
                    self.responsePromises[requestID].reject(new Error('disconnected'))
                    delete self.responsePromises[requestID]
                }
            })
        }
        
        app.post('/forwardRequest', function(req, res) {
            let sourceNodeID = req.body.nodeID
            let requestInfo = req.body.requestInfo
            let resources = req.body.resources
            let responder = self._newResponder(function(status, responseBody) {
                res.status(status).send(responseBody)
            })
            
            self.emit('request', sourceNodeID, requestInfo, resources, responder)
        })
        
        app.post('/forwardEvent', function(req, res) {
            let sourceNodeID = req.body.nodeID
            let eventInfo = req.body.eventInfo
            
            self.emit('event', sourceNodeID, eventInfo)
        })
    }
    
    _newResponder(responder) {
        let alreadyResponded = false
        
        return function(status, responseBody) {
            if(!alreadyResponded) {
                alreadyResponded = true
                
                responder(status, responseBody)
            }
        }
    }
    
    _newRequestOptions(options) {
        let newOptions = { }
        
        if(this.options.https) {
            for(let k in this.options.https) {
                newOptions[k] = this.options.https[k]
            }
        }
        
        for(let k in options) {
            newOptions[k] = options[k]
        }
        
        return newOptions
    }
        
    forwardRequests(forwardingMap, request) {
        let self = this
        let nodeIDs = Object.keys(forwardingMap)
        let forwardPromises = [ ]
        let responseMap = { }
        
        return this.options.getAddresses(nodeIDs).then(function(addresses) {
            for(let i = 0; i < nodeIDs.length; i += 1) {
                let address = addresses[i]
                let requestBody = {
                    nodeID: self.nodeID,
                    requestInfo: request,
                    resources: forwardingMap[nodeIDs[i]]
                }
                
                if(address == null) {
                    if(self.cloudTunnel.isConnected()) {
                        let requestID = self.nextRequestID ++
                        let responseResolve = null
                        let responseReject = null
                        let responsePromise = new Promise(function(resolve, reject) { responseResolve = resolve; responseReject = reject })
                        let responseEntry = self.responsePromises[requestID] = {
                            resolve: responseResolve,
                            reject: responseReject
                        }
                        
                        requestBody.destinationNodeID = nodeIDs[i]
                        
                        self.cloudTunnel.sendMessage('forwardRequest', {
                            id: requestID,
                            destinationNodeID: nodeIDs[i],
                            request: requestBody,
                            resources: forwardingMap[nodeIDs[i]]
                        })
                        
                        forwardPromises.push(responsePromise.then(function(response) {
                            for(var resourceID in response) {
                                responseMap[resourceID] = response[resourceID]
                            }
                        }))
                    }
                }
                else {
                    forwardPromises.push(new Promise(function(resolve, reject) {
                        requestLib.post(address.protocol+'://'+address.address+':'+address.port+'/forwardRequest', self._newRequestOptions({
                            body: requestBody,
                            json: true
                        }), function(error, response, responseBody) {
                            if(error || response.statusCode != 200) {
                                for(let resourceID of forwardingMap[nodeIDs[i]]) {
                                    responseMap[resourceID] = { receivedResponse: false, response: null }
                                }
                            }
                            else {
                                for(var resourceID in responseBody) {
                                    responseMap[resourceID] = responseBody[resourceID]
                                }
                            }
                            
                            resolve()
                        })
                    }))
                }
            }
            
            return Promise.all(forwardPromises)
        }).then(function() {
            return responseMap
        })
    }
    
    forwardEvent(nodeIDs, event) {
        let self = this
        let forwardPromises = [ ]
    
        return this.options.getAddresses(nodeIDs).then(function(addresses) {
            for(let i = 0; i < nodeIDs.length; i += 1) {
                let address = addresses[i]
                let requestBody = {
                    nodeID: self.nodeID,
                    eventInfo: event
                }
            
                if(address == null) {
                    requestBody.destinationNodeID = nodeIDs[i]
                    
                    // to cloud
                    forwardPromises.push(new Promise(function(resolve, reject) {
                        if(self.cloudTunnel) {
                            self.cloudTunnel.sendMessage('forwardEvent', requestBody)
                        }
                        
                        resolve()
                    }))
                }
                else {
                    forwardPromises.push(new Promise(function(resolve, reject) {
                        requestLib.post(address.protocol+'://'+address.address+':'+address.port+'/forwardEvent', self._newRequestOptions({
                            body: requestBody,
                            json: true
                        }), function(error, response, responseBody) {
                            resolve()
                        })
                    }))
                }
            }
            
            return Promise.all(forwardPromises)
        })
    }
}

module.exports = {
    ForwardingManager: ForwardingManager
}
