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
const expect = require('expect.js')
const should = require('should')
const shouldPromised = require('should-promised')
const DeviceDB = require('./devicedbServerTestFixture')
const devicedb = require('../src/runtime/devicedb')
const devicejs = require('../src/core/httpCore')
const http = require('http')
const path = require('path')
const fs = require('fs')
const DDBResourceIndex = require('../src/core/ddbResourceIndex')
const DDBSubscriberRegistry = require('../src/core/ddbSubscriberRegistry')
const ResourceGroupTree = require('../src/core/resourceGroupTree')

const DEVICEDB_PORT = 9090
const DEVICEDB_DIRECTORY = '/tmp/testDeviceJSDB'

let ddbServer = null
let coreServer = null
let ddbCA = [
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/ca.cert.pem')),
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/intermediate.cert.pem'))
]

before(function() {
    ddbServer = new DeviceDB()
});

after(function(done) {
    done();
});

function newDDBClient() {
    return devicedb({ uri: 'https://127.0.0.1:'+ DEVICEDB_PORT, https: { ca: ddbCA } });
}

describe('DDBSubscriberRegistry', function() {
    const serverID = 'ABC123'
    const alternateServerID = 'DEF345'
    let ddbClient = newDDBClient()
    let resourceGroupTree = new ResourceGroupTree(ddbClient)
    let resourceIndex = new DDBResourceIndex(ddbClient, resourceGroupTree)
    let subscriberRegistry = null
    let alternateSubscriberRegistry = null
    
    beforeEach(function() {
        subscriberRegistry = new DDBSubscriberRegistry(serverID, ddbClient, resourceIndex)
        alternateSubscriberRegistry = new DDBSubscriberRegistry(alternateServerID, ddbClient, resourceIndex)
        return ddbServer.stop().then(function() {
            return ddbServer.start()
        })
    })

    describe('#subscribe + #unsubscribe', function() {
        it('one subscribe should result in that subscriber being in the results for that subscription type', function() {
            return resourceIndex.addResource({
                id: 'aaaaaa',
                type: 'ABC',
                interfaces: [ 'XXX', 'YYY' ]
            }).then(function() {
                return subscriberRegistry.subscribe('subscriber1', 'id="aaaaaa"', 'motion')
            }).then(function() {
                return subscriberRegistry.getSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ subscriber1: true })
            }).then(function() {
                return subscriberRegistry.getRemoteSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ })
            })
        })
        
        it('one subscribe should result in that subscriber being in the results for that subscription type and in the remote subscriptions of other subscriber registrys', function() {
            
            return resourceIndex.addResource({
                id: 'aaaaaa',
                type: 'ABC',
                interfaces: [ 'XXX', 'YYY' ]
            }).then(function() {
                return subscriberRegistry.subscribe('subscriber1', 'id="aaaaaa"', 'motion')
            }).then(function() {
                return alternateSubscriberRegistry.subscribe('subscriber2', 'id="aaaaaa"', 'motion')
            }).then(function() {
                return subscriberRegistry.getSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ subscriber1: true })
            }).then(function() {
                return alternateSubscriberRegistry.getSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ subscriber2: true })
            }).then(function() {
                return subscriberRegistry.getRemoteSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ 'DEF345': true })
            }).then(function() {
                return alternateSubscriberRegistry.getRemoteSubscribers('aaaaaa', 'motion').should.be.fulfilledWith({ 'ABC123': true })
            })
        })
    })
})
