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
const StateCache = require('../src/core/resourceStateCache')

http.globalAgent.maxSockets = 1000;//Infinity; // Ensures we can send lots of http requests out at once

const DEVICEDB_PORT = 9090
const DEVICEJS_PORT = 10001
const DEVICEDB_DIRECTORY = '/tmp/testDeviceJSDB'

let ddbServer = null
let coreServer = null
let ddbCA = [
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/ca.cert.pem')),
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/intermediate.cert.pem'))
]

before(function() {
    ddbServer = new DeviceDB()
    coreServer = new devicejs.DeviceJSCore(DEVICEJS_PORT, { 
        nodeID: 'abc123',
        moduleInstallDirectory: '/tmp',
        databaseConfig: {
            uri: 'https://127.0.0.1:'+DEVICEDB_PORT,
            https: {
                ca: ddbCA
            }
        },
        jwtSecret: 'myJWTSecretTemporary'
    })
});

after(function(done) {
    done();
});

function newDDBClient() {
    return devicedb({ uri: 'https://127.0.0.1:'+ DEVICEDB_PORT, https: { ca: ddbCA } });
}

function newDJSClient() {
    return new devicejs.DeviceJSPeer('http://127.0.0.1:' + DEVICEJS_PORT, {
        apiKey: 'abc123',
        apiSecret: 'myAPISecret'
    });
}

describe('ResourceLinkGraph', function() {
    this.timeout(60000)

    let ddbClient = newDDBClient()
    let stateCache
    
    beforeEach(function() {
        stateCache = new StateCache({
            ddb: ddbClient
        })

        return ddbServer.stop().then(function() {
            return ddbServer.start()
        })
    })

    describe('updating cache', function() {
        it('should update cached value for specified points', function() {
            return stateCache.update([
                { op: 'set', resource: 'device1', property: 'power', value: 'off' },
                { op: 'set', resource: 'device1', property: 'brightness', value: 0.5 },
                { op: 'set', resource: 'device2', property: 'hsl', value: { h: 1, s: 2, l: 3 } }
            ]).then(() => {
                return stateCache.query([
                    { resource: 'device1', property: 'power' },
                    { resource: 'device2', property: 'hsl' }
                ])
            }).then((result) => {
                for(let e of result) {
                    delete e.timestamp
                }

                result.should.be.eql([
                    { resource: 'device1', property: 'power', value: 'off' },
                    { resource: 'device2', property: 'hsl', value: { h: 1, s: 2, l: 3 } }
                ])

                return stateCache.query([
                    { resource: 'device1' },
                    { resource: 'device2' }
                ])
            }).then((result) => {
                for(let e of result) {
                    delete e.timestamp
                }

                result.should.be.eql([
                    { resource: 'device1', property: 'brightness', value: 0.5 },
                    { resource: 'device1', property: 'power', value: 'off' },
                    { resource: 'device2', property: 'hsl', value: { h: 1, s: 2, l: 3 } }
                ])
            }).then(() => {
                return stateCache.update([
                    { op: 'delete', resource: 'device1' }
                ])
            }).then(() => {
                return stateCache.query([
                    { resource: 'device1' },
                    { resource: 'device2' }
                ])
            }).then((result) => {
                for(let e of result) {
                    delete e.timestamp
                }

                result.should.be.eql([
                    { resource: 'device2', property: 'hsl', value: { h: 1, s: 2, l: 3 } }
                ])
            })
        })
    })
})