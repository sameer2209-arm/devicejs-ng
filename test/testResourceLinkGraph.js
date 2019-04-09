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
const LinkGraph = require('../src/core/resourceLinkGraph')

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
    let linkGraph
    
    beforeEach(function() {
        linkGraph = new LinkGraph({
            ddb: ddbClient
        })

        return ddbServer.stop().then(function() {
            return ddbServer.start()
        })
    })

    describe('creating links', function() {
        it('should add links to the database', function() {
            return linkGraph.update([
                { op: 'link', source: 'device1', dest: 'device2', label: 'parent' },
                { op: 'link', source: 'device2', dest: 'device1', label: 'child' }
            ]).then(() => {
                return linkGraph.edges([ 'device1', 'device2' ])
            }).then((edges) => {
                edges.should.be.eql([ 
                    { source: 'device1', dest: 'device2', label: 'parent' },
                    { source: 'device2', dest: 'device1', label: 'child' }
                ])
            })
        })
    })

    describe('deleting links', function() {
        it('should remove the links', function() {
            return linkGraph.update([
                { op: 'link', source: 'device1', dest: 'device2', label: 'parent' },
                { op: 'link', source: 'device2', dest: 'device1', label: 'child' }
            ]).then(() => {
                return linkGraph.edges([ 'device1', 'device2' ])
            }).then((edges) => {
                edges.should.be.eql([ 
                    { source: 'device1', dest: 'device2', label: 'parent' },
                    { source: 'device2', dest: 'device1', label: 'child' }
                ])

                return linkGraph.update([
                    { op: 'unlink', source: 'device1', dest: 'device2' }
                ])
            }).then(() => {
                return linkGraph.edges([ 'device1', 'device2' ])
            }).then((edges) => {
                edges.should.be.eql([ 
                    { source: 'device2', dest: 'device1', label: 'child' }
                ])
            })
        })
    })

    describe('removing a resource', function() {
        it('should remove the links', function() {
            return linkGraph.update([
                { op: 'link', source: 'device1', dest: 'device2', label: 'parent' },
                { op: 'link', source: 'device2', dest: 'device1', label: 'child' }
            ]).then(() => {
                return linkGraph.edges([ 'device1', 'device2' ])
            }).then((edges) => {
                edges.should.be.eql([ 
                    { source: 'device1', dest: 'device2', label: 'parent' },
                    { source: 'device2', dest: 'device1', label: 'child' }
                ])

                return linkGraph.update([
                    { op: 'unlinkAll', node: 'device1' }
                ])
            }).then(() => {
                return linkGraph.edges([ 'device1', 'device2' ])
            }).then((edges) => {
                edges.should.be.eql([ ])
            })
        })
    })
})