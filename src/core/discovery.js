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

//const mdns = require('mdns')
const EventEmitter = require('events').EventEmitter

class DeviceJSDiscoverer extends EventEmitter {
    constructor(nodeID, protocol, servicePort, databasePort) {
        super()
        
        this.servicePort = servicePort
        this.databasePort = databasePort || null
        this.protocol = protocol
        this.nodeID = nodeID
    }
    
    start() {
        
    }
    
    stop() {
        
    }
    
    isStopped() {
        
    }
    
    _discoverNode(nodeID, serviceAddress, servicePort, databasePort) {
        this.emit('discover', nodeID, serviceAddress, servicePort, databasePort)
    }
}

class MDNSDiscoverer extends DeviceJSDiscoverer {
    constructor(nodeID, protocol, servicePort, databasePort) {
        super(nodeID, protocol, servicePort, databasePort)
    }
    
    start() {
        /*const self = this
        
        this.stop()
        
        this.advertisement = mdns.createAdvertisement(mdns.tcp(this.protocol), this.servicePort, { 
            name:'DeviceJS '+this.nodeID,
            txtRecord: {
                databasePort: this.databasePort
            }
        })
        
        this.httpBrowser = mdns.createBrowser(mdns.tcp('http'), {
            resolverSequence: [
                mdns.rst.DNSServiceResolve(),
                'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[0]}),
                mdns.rst.makeAddressesUnique()
            ]
        })
        
        this.httpsBrowser = mdns.createBrowser(mdns.tcp('https'), {
            resolverSequence: [
                mdns.rst.DNSServiceResolve(),
                'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[0]}),
                mdns.rst.makeAddressesUnique()
            ]
        })
        
        function serviceUp(service, protocol) {
            if(service.name.startsWith('DeviceJS')) {
                let nodeID = service.name.split(' ')[1]
                let serviceAddress = service.addresses[0]
                let servicePort = parseInt(service.port)
                let databasePort = parseInt(service.txtRecord.databasePort)

                if(nodeID !== self.nodeID) {
                    self._discoverNode(nodeID, protocol, serviceAddress, servicePort, databasePort)
                }
            }
        }
        
        this.httpBrowser.on('serviceUp', function(service) {
            serviceUp(service, 'http')
        }).on('serviceDown', function(service) {
        }).on('error', function(error) {
            //console.log('ERROR MDNS', error.stack)
        })
        
        this.httpsBrowser.on('serviceUp', function(service) {
            serviceUp(service, 'https')
        }).on('serviceDown', function(service) {
        }).on('error', function(error) {
            //console.log('ERROR MDNS', error.stack)
        })
        
        this.advertisement.start()
        this.httpBrowser.start()
        this.httpsBrowser.start()*/
    }
    
    stop() {
        /*if(this.advertisement) {
            this.advertisement.stop()
            this.httpBrowser.stop()
            this.httpsBrowser.stop()
            this.advertisement = null
            this.httpBrowser = null
            this.httpsBrowser = null
        }*/
    }
    
    isStopped() {
        return !!this.advertisement
    }
}


function createDeviceJSDiscoverer(type, nodeID, protocol, servicePort, databasePort) {
    if(type == 'mdns') {
        return new MDNSDiscoverer(nodeID, protocol, servicePort, databasePort)
    }
    else {
        throw new Error('No such discoverer')
    }
}

module.exports = {
    createDeviceJSDiscoverer: createDeviceJSDiscoverer
}
