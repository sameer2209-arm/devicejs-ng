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

const socketioClient = require('socket.io-client')
const EventEmitter = require('events').EventEmitter
const https = require('https')
const url = require('url')

const RETRY_INTERVAL = 5000

class CloudTunnel extends EventEmitter {
    constructor(address, options) {
        super()
        
        this.socket = null
        this.options = options
        this.address = address
        this._isConnected = false
    }
    
    start() {
        let self = this
        
        return self.stop().then(function() {
            return new Promise(function(resolve, reject) {
                let socketConfig = { forceNew: true }
                
                if(self.options.https && self.options.https.client) {
                    let agentOptions = { }
                    
                    agentOptions.key = self.options.https.client.key
                    agentOptions.cert = self.options.https.client.cert
                    
                    agentOptions.checkServerIdentity = function(servername, cert) {
                        
                    }
                    
                    socketConfig.agent = new https.Agent(agentOptions)
                }
                
                let cloudAddress = url.parse(self.address)

                socketConfig.path = cloudAddress.path
                socketConfig.transports = [ 'websocket' ]
                cloudAddress.path = ''
                cloudAddress.pathname = ''

                self.socket = socketioClient.connect(cloudAddress.format(), socketConfig)
                self.emit('connecting')
                
                self.socket.on('connect', function() {
                    console.log('connect event')
                    self._isConnected = true
                    resolve();
                    self.emit('connect')
                    self.socket.removeAllListeners('message')

                    self.socket.on('message', function(message) {
                        self.emit(message.t, message.m)
                    })
                }).on('error', function(error) {
                    if(error == 'Not authorized') {
                        console.log('not authorized')
                        self.socket.disconnect()
                        
                        setTimeout(function() {
                            self.socket.connect()
                        }, RETRY_INTERVAL)
                    }
                    self.emit('error', error)
                }).on('disconnect', function() {
                    console.log('disconnected from cloud')
                    self._isConnected = false
                    reject();
                    self.emit('disconnect')
                }).on('reconnect', function(reconnectAttempts) {
                    console.log('reconnect')
                    self.emit('reconnect', reconnectAttempts)
                }).on('reconnect_attempt', function() {
                    self.emit('reconnect_attempt')
                }).on('reconnecting', function(attemptNumber) {
                    self.emit('connecting')
                    self.emit('reconnecting', attemptNumber)
                }).on('reconnect_error', function(error) {
                    self.emit('reconnect_error', error)
                }).on('reconnect_failed', function() {
                    self.emit('reconnect_failed')
                })
            })
        })
    }
    
    stop() {
        let self = this
        
        return new Promise(function(resolve, reject) {
            if(self.socket !== null) {
                self.socket.removeAllListeners('connect')
                self.socket.removeAllListeners('error')
                self.socket.removeAllListeners('disconnect')
                self.socket.removeAllListeners('reconnect')
                self.socket.removeAllListeners('reconnect_attempt')
                self.socket.removeAllListeners('reconnecting')
                self.socket.removeAllListeners('reconnect_error')
                self.socket.removeAllListeners('reconnect_failed')
                self.socket.disconnect()
                self.socket = null
            }

            resolve()
        })
    }
    
    sendMessage(type, message) {
        if(this.socket != null) {
            this.socket.emit('message', { t: type, m: message })
        }
    }
    
    getAddress() {
        return this.address
    }
    
    isConnected() {
        return this._isConnected
    }
}

module.exports = {
    CloudTunnel: CloudTunnel
}
