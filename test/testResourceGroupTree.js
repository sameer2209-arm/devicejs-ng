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
var ResourceGroupTree = require('../src/core/resourceGroupTree');
var util = require('util');
var ddb = require('../src/runtime/devicedb')({ });
var Promise = require('es6-promise').Promise;

var MockDDB = function() {
    this.progress = 0;
    this.shared = this;
};

MockDDB.prototype.callNext = function(actualMethodName, args) {
    var nextCall = this.callSequence[this.progress++];

    should(nextCall != null).ok;

    var expectedMethodName = nextCall.method;
    var expectArgs = nextCall.expectArgs;
    var actualArgs = [ ];
    
    for(var i=0;i<args.length;i++) {
        actualArgs.push(args[i]);
    }
    
    var resolveEndPromise = null;
    var endPromise = new Promise(function(resolve) {
        resolveEndPromise = resolve;
    });
    var end = function() {
        resolveEndPromise();
    };
    
    var hasCallback = false;
    
    for(var i=0;i<expectArgs.length;i++) {
        if(typeof expectArgs[i] === 'function') {
            (typeof actualArgs[i]).should.be.eql('function');
            
            hasCallback = true;
            var expectedCB = expectArgs[i];
            var actualCB = actualArgs[i];
            
            actualArgs[i] = expectArgs[i] = null;
            expectedCB(actualCB, end);
        }
    }
    
    if(!hasCallback) {
        resolveEndPromise();
    }

    actualMethodName.should.be.eql(expectedMethodName);
    actualArgs.should.be.eql(expectArgs);

    if(nextCall.async) {
        if(nextCall.hasOwnProperty('returns')) {
            return endPromise.then(function() {
                return nextCall.returns
            });
        }
        else {
            return endPromise.then(function() {
                throw nextCall.throws;
            });
        }
    }
    else {
        if(nextCall.hasOwnProperty('returns')) {
            return nextCall.returns;
        }
        else {
            throw nextCall.throws;
        }
    }
};

MockDDB.extend = function(callSequence) {
    var NewMockDDB = function() { 
        MockDDB.call(this);

        if(arguments.length == 1) {
            this.callSequence = arguments[0];
        }
    };

    util.inherits(NewMockDDB, MockDDB);

    NewMockDDB.prototype.callSequence = callSequence;

    return NewMockDDB;
};

MockDDB.prototype.put = function() {
    return this.callNext('put', arguments);
};

MockDDB.prototype.batch = function() {
    return this.callNext('batch', arguments);
};

MockDDB.prototype.get = function() {
    return this.callNext('get', arguments);
};

MockDDB.prototype.getMatches = function() {
    return this.callNext('getMatches', arguments);
};

MockDDB.prototype.delete = function() {
    return this.callNext('delete', arguments);
};

var RESOURCE_GROUPS_PREFIX = 'devicejs.core.resourceGroups';

describe('registry.ResourceRegistry', function() {
    var devicedb = MockDDB.extend([ ]);

    describe('registry.ResourceIndex#createGroup', function() {
        it('should do one get and a put if no siblings exist', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: { context: 'asdfasdf', siblings: [ ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', JSON.stringify({ }), 'asdfasdf' ], returns: undefined, async: true }
            ])).createGroup('A/B/C').should.be.fulfilledWith(undefined);
        });

        it('should do one get and a put if value is null', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', JSON.stringify({ }), '' ], returns: undefined, async: true }
            ])).createGroup('A/B/C').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and a put and merge siblings if the group has multiple values', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', JSON.stringify({ a: true, b: true }), 'asdfasdf' ], returns: undefined, async: true }
            ])).createGroup('A/B/C').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and a put and merge siblings if the group has multiple values and ignore invalid siblings', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), '' ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', JSON.stringify({ a: true }), 'asdfasdf' ], returns: undefined, async: true }
            ])).createGroup('A/B/C').should.be.fulfilledWith(undefined);
        });
    });

    describe('registry.ResourceIndex#deleteGroup', function() {
        /*it('should do one get and one delete', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: { context: 'asdfasdf' }, async: true },
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B' ], returns: { context: 'asdfasdf', siblings: [ ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B', JSON.stringify({ }), 'asdfasdf' ], returns: undefined, async: true },
                { method: 'delete', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', 'asdfasdf' ], returns: undefined, async: true }
            ])).deleteGroup('A/B/C').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one delete no context', function() {
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C' ], returns: null, async: true },
                { method: 'delete', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B/C', '' ], returns: undefined, async: true }
            ])).deleteGroup('A/B/C').should.be.fulfilledWith(undefined);
        });*/
    });

    describe('registry.ResourceIndex#joinGroup', function() {
        it('should do one get and one put with no context and no merging if the get returns no value at a child group', function() {
            var expectedPutObject = { };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).joinGroup('abc123', 'A').should.be.fulfilledWith(undefined);
        });

        it('should do one get and one put with no context and no merging if the get returns no value at the root group specified with no group parameter', function() {
            var expectedPutObject = { };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).joinGroup('abc123').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with no context and no merging if the get returns no value at the root group specified with an empty string group parameter', function() {
            var expectedPutObject = { };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).joinGroup('abc123', '').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with context and merging if the get returns a value at a child group', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).joinGroup('abc123', 'A').should.be.fulfilledWith(undefined);
        });

        it('should do one get and one put with context and merging if the get returns a value at a child group specified with no group parameter', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).joinGroup('abc123').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with context and merging if the get returns a value at a child group specified with an empty string group parameter', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            expectedPutObject[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).joinGroup('abc123', '').should.be.fulfilledWith(undefined);
        });
    });

    describe('registry.ResourceIndex#leaveGroup', function() {
        it('should do one get and one put with no context and no merging if the get returns no value at a child group', function() {
            var expectedPutObject = { };
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).leaveGroup('abc123', 'A').should.be.fulfilledWith(undefined);
        });

        it('should do one get and one put with no context and no merging if the get returns no value at the root group specified with no group parameter', function() {
            var expectedPutObject = { };
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).leaveGroup('abc123').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with no context and no merging if the get returns no value at the root group specified with an empty string group parameter', function() {
            var expectedPutObject = { };
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: null, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), '' ], returns: undefined, async: true }
            ])).leaveGroup('abc123', '').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with context and merging if the get returns a value at a child group', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            
            var sibling1 = { };
            sibling1[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }), JSON.stringify(sibling1) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).leaveGroup('abc123', 'A').should.be.fulfilledWith(undefined);
        });

        it('should do one get and one put with context and merging if the get returns a value at a child group specified with no group parameter', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            
            var sibling1 = { };
            sibling1[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }), JSON.stringify(sibling1) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).leaveGroup('abc123').should.be.fulfilledWith(undefined);
        });
        
        it('should do one get and one put with context and merging if the get returns a value at a child group specified with an empty string group parameter', function() {
            var expectedPutObject = { 
                a: true,
                b: true
            };
            
            var sibling1 = { };
            sibling1[ddb.encodeKey('abc123')] = true;
            
            return new ResourceGroupTree(new devicedb([
                { method: 'get', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root' ], returns: { context: 'asdfasdf', siblings: [ JSON.stringify({ a: true }), JSON.stringify({ b: true }), JSON.stringify(sibling1) ] }, async: true },
                { method: 'put', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', JSON.stringify(expectedPutObject), 'asdfasdf' ], returns: undefined, async: true }
            ])).leaveGroup('abc123', '').should.be.fulfilledWith(undefined);
        });
    });

    describe('registry.ResourceIndex#getGroup', function() {
        it('should get a filled out decoded hierarchy object when retrieving a non-root location that exists', function() {
            function cbSequence1(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify({ }) ]
                });
                
                end();
            }
            
            function cbSequence2(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify({ }) ]
                });
                
                end();
            }
            
            function cbSequence3(next, end) {
                var s1 = { };
                var s2 = { };
                var s3 = { };
                
                s1[ddb.encodeKey('x')] = true;
                s1[ddb.encodeKey('y')] = true;
                
                s2[ddb.encodeKey('a')] = true;
                s2[ddb.encodeKey('b')] = true;
                
                s3[ddb.encodeKey('c')] = true;
                s3[ddb.encodeKey('d')] = true;
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s1) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s2) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s3) ]
                });
                
                end();
            }
            
            return new ResourceGroupTree(new devicedb([
                { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence1 ], returns: undefined, async: true }
            ])).getGroup('A').should.be.fulfilledWith({
                children: { },
                resources: { }
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence2 ], returns: undefined, async: true }
                ])).getGroup('A');
            }).should.be.fulfilledWith({
                children: { 
                    B: {
                        children: {
                            C: {
                                children: { },
                                resources: { }
                            }
                        },
                        resources: { }
                    }
                },
                resources: { }
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence3 ], returns: undefined, async: true }
                ])).getGroup('A');
            }).should.be.fulfilledWith({
                children: { 
                    B: {
                        children: {
                            C: {
                                children: { },
                                resources: { 
                                    c: { },
                                    d: { }
                                }
                            }
                        },
                        resources: { 
                            a: { },
                            b: { }
                        }
                    }
                },
                resources: { 
                    x: { },
                    y: { }
                }
            });
        });

        it('should get a filled out decoded hierarchy object when retrieving root location', function() {
            function cbSequence1(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify({ }) ]
                });
                
                end();
            }
            
            function cbSequence2(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify({ }) ]
                });
                
                end();
            }
            
            function cbSequence3(next, end) {
                var s1 = { };
                var s2 = { };
                var s3 = { };
                var s4 = { };
                
                s1[ddb.encodeKey('z')] = true;
                
                s2[ddb.encodeKey('x')] = true;
                s2[ddb.encodeKey('y')] = true;
                
                s3[ddb.encodeKey('a')] = true;
                s3[ddb.encodeKey('b')] = true;
                
                s4[ddb.encodeKey('c')] = true;
                s4[ddb.encodeKey('d')] = true;
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s1) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s2) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s3) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s4) ]
                });
                
                end();
            }
            
            return new ResourceGroupTree(new devicedb([
                { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence1 ], returns: undefined, async: true }
            ])).getGroup().should.be.fulfilledWith({
                children: { },
                resources: { }
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence2 ], returns: undefined, async: true }
                ])).getGroup();
            }).should.be.fulfilledWith({
                children: {
                    A: {
                        children: { 
                            B: {
                                children: {
                                    C: {
                                        children: { },
                                        resources: { }
                                    }
                                },
                                resources: { }
                            }
                        },
                        resources: { }
                    }
                },
                resources: { }
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence3 ], returns: undefined, async: true }
                ])).getGroup();
            }).should.be.fulfilledWith({
                children: {
                    A: {
                        children: { 
                            B: {
                                children: {
                                    C: {
                                        children: { },
                                        resources: { 
                                            c: { },
                                            d: { }
                                        }
                                    }
                                },
                                resources: { 
                                    a: { },
                                    b: { }
                                }
                            }
                        },
                        resources: { 
                            x: { },
                            y: { }
                        }
                    }
                },
                resources: { 
                    z: { }
                }
            });
        });

        it('should return an empty hierarchy when getting the root node and it doesn\'t exist', function() {
            function cbSequence1(next, end) {
                end();
            }
            
            function cbSequence2(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root',
                    context: 'asdfasdf',
                    siblings: [ ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ ]
                });
                
                end();
            }
            
            return new ResourceGroupTree(new devicedb([
                { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence1 ], returns: undefined, async: true }
            ])).getGroup().should.be.fulfilledWith({
                children: { },
                resources: { }
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence2 ], returns: undefined, async: true }
                ])).getGroup()
            }).should.be.fulfilledWith({
                children: { },
                resources: { }
            });
        });

        it('should throw an error when getting a non-root node and it doesn\'t exist', function() {
            function cbSequence1(next, end) {
                end();
            }
            
            function cbSequence2(next, end) {
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root',
                    context: 'asdfasdf',
                    siblings: [ ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ ]
                });
                
                end();
            }
            
            return new ResourceGroupTree(new devicedb([
                { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence1 ], returns: undefined, async: true }
            ])).getGroup('A').should.be.rejected();
        });
    });

    describe('registry.ResourceIndex#listGroup', function() {
        it('should return a flat set of resource ids contained in a group and its subgroups', function() { 
            function cbSequence1(next, end) {
                var s1 = { };
                var s2 = { };
                var s3 = { };
                
                s1[ddb.encodeKey('a')] = true;
                s1[ddb.encodeKey('b')] = true;
                
                s2[ddb.encodeKey('c')] = true;
                s2[ddb.encodeKey('d')] = true;
                
                s3[ddb.encodeKey('e')] = true;
                s3[ddb.encodeKey('f')] = true;
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s1) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s2) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s3) ]
                });
                
                end();
            }
            
            function cbSequence2(next, end) {
                var s1 = { };
                var s2 = { };
                
                s1[ddb.encodeKey('c')] = true;
                s1[ddb.encodeKey('d')] = true;
                
                s2[ddb.encodeKey('e')] = true;
                s2[ddb.encodeKey('f')] = true;
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s1) ]
                });
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s2) ]
                });
                
                end();
            }
            
            function cbSequence3(next, end) {
                var s1 = { };
                
                s1[ddb.encodeKey('e')] = true;
                s1[ddb.encodeKey('f')] = true;
                
                next(null, {
                    prefix: RESOURCE_GROUPS_PREFIX+'.root/A/B',
                    key: RESOURCE_GROUPS_PREFIX+'.root/A/B/C',
                    context: 'asdfasdf',
                    siblings: [ JSON.stringify(s1) ]
                });
                
                end();
            }
            
            function cbSequence4(next, end) {
                end();
            }
            
            return new ResourceGroupTree(new devicedb([
                { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root', cbSequence1 ], returns: undefined, async: true }
            ])).listGroup().should.be.fulfilledWith({
                a: true,
                b: true,
                c: true,
                d: true,
                e: true,
                f: true
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence2 ], returns: undefined, async: true }
                ])).listGroup('A').should.be.fulfilledWith({
                    c: true,
                    d: true,
                    e: true,
                    f: true
                });
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A/B', cbSequence3 ], returns: undefined, async: true }
                ])).listGroup('A/B').should.be.fulfilledWith({
                    e: true,
                    f: true
                });
            }).then(function() {
                return new ResourceGroupTree(new devicedb([
                    { method: 'getMatches', expectArgs: [ RESOURCE_GROUPS_PREFIX+'.root/A', cbSequence4 ], returns: undefined, async: true }
                ])).listGroup('A').should.be.fulfilledWith({
                });
            });
        });
    });
});

