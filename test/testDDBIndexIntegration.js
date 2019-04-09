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
var expect = require('expect.js');
var should = require('should');
var shouldPromised = require('should-promised');
var util = require('util');
var fs = require('fs');
var path = require('path');
var devicedb = require('../src/runtime/devicedb');
var DeviceDB = require('./devicedbServerTestFixture');
var ddb = devicedb({ });
var Promise = require('es6-promise').Promise;
var registry = require('../src/core/registry');
var ResourceIndex = require('../src/core/ddbResourceIndex');
var ResourceGroupTree = require('../src/core/resourceGroupTree');

var DDB = 'https://localhost:9090';
var ddbCA = [
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/ca.cert.pem')),
    fs.readFileSync(path.resolve(__dirname, '../deps/devicedb/src/devicedb/test_certs/intermediate.cert.pem'))
]

describe('registry.ResourceRegistry + ResourceGroupTree + ddb ResourceRegistry', function() {
    var ddbClient = ddb.createClient({ uri: DDB, https: { ca: ddbCA } });
    var ddbServer = new DeviceDB();

    before(function() {
        return ddbServer.start();
    });
    
    after(function() {
        return ddbServer.stop();
    })

    describe('registry.ResourceIndex#createGroup', function() {
        it('should work', function() {
            var resourceGroupTree = new ResourceGroupTree(ddbClient);
            var resourceIndex = new ResourceIndex(ddbClient, resourceGroupTree);
            var resourceRegistry = new registry.ResourceRegistry(resourceIndex);

            return resourceRegistry.getSelection('id="abc123"').should.be.fulfilledWith({ }).then(function() {
                return resourceIndex.addResource({
                    id: 'abc123',
                    type: 'type1',
                    interfaces: [ 'interface1', 'interface2' ]
                });
            }).then(function() {
                return resourceIndex.addResource({
                    id: 'def123',
                    type: 'type2',
                    interfaces: [ 'interface1', 'interface2', 'interface3' ]
                });
            }).then(function() {
                return resourceIndex.joinGroup('abc123', 'A/B/C');
            }).then(function() {
                return resourceIndex.joinGroup('def123', 'A/B');
            }).then(function() {
                return resourceIndex.joinGroup('def123', 'D/E');
            }).then(function() {
                return resourceIndex.getResourceProperties('abc123').should.be.fulfilledWith({
                    type: 'type1',
                    interfaces: [ 'interface1', 'interface2' ],
                    groups: { 
                        'A/B/C': true
                    }
                })
            }).then(function() {
                return resourceIndex.getResourceProperties('def123').should.be.fulfilledWith({
                    type: 'type2',
                    interfaces: [ 'interface1', 'interface2', 'interface3' ],
                    groups: {
                        'A/B': true,
                        'D/E': true
                    }
                })
            }).then(function() {
                return resourceRegistry.getSelection('id="abc123"').should.be.fulfilledWith({
                    'abc123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('id="def123"').should.be.fulfilledWith({
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('id="def123" or id="abc123"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('id="def123" and id="abc123"').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceRegistry.getSelection('type="type1"').should.be.fulfilledWith({ 
                    'abc123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('type="type2"').should.be.fulfilledWith({ 
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('type="type1" or type="type2"').should.be.fulfilledWith({ 
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('type="type1" and type="type2"').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceRegistry.getSelection('interface="interface1"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('interface="interface3"').should.be.fulfilledWith({
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('id="abc123" or interface="interface3"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('group="A"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('group="A/B"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('group="A/B/C"').should.be.fulfilledWith({
                    'abc123': true
                });
            }).then(function() {
                return resourceRegistry.getSelection('group="A/B/C" or group="D"').should.be.fulfilledWith({
                    'abc123': true,
                    'def123': true
                });
            });
        });
    });
});
