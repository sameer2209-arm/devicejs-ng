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
var expect = require('expect.js');
var should = require('should');
var shouldPromised = require('should-promised');
var registry = require('../src/core/registry');
var selection = require('../src/core/selection');
var util = require('util');
var Promise = require('es6-promise').Promise;

var MockResourceIndex = function() {
    this.progress = 0;
};

MockResourceIndex.prototype.callNext = function(actualMethodName, args) {
    var nextCall = this.callSequence[this.progress++];

    should(nextCall != null).ok;

    var expectedMethodName = nextCall.method;
    var expectArgs = nextCall.expectArgs;
    var actualArgs = [ ];

    for(var i=0;i<args.length;i++) {
        actualArgs.push(args[i]);
    }

    actualMethodName.should.be.eql(expectedMethodName);
    actualArgs.should.be.eql(expectArgs);

    if(nextCall.async) {
        if(nextCall.hasOwnProperty('returns')) {
            return Promise.resolve(nextCall.returns);
        }
        else {
            return Promise.reject(nextCall.throws);
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

MockResourceIndex.extend = function(callSequence) {
    var NewMockResourceIndex = function() { 
        MockResourceIndex.call(this);

        if(arguments.length == 1) {
            this.callSequence = arguments[0];
        }
    };

    util.inherits(NewMockResourceIndex, MockResourceIndex);

    NewMockResourceIndex.prototype.callSequence = callSequence;

    return NewMockResourceIndex;
};

MockResourceIndex.prototype.getResources = function(keyType, key) {
    return this.callNext('getResources', arguments);
};

MockResourceIndex.prototype.getResourceProperties = function(resourceID) {
    return this.callNext('getResourceProperties', arguments)
};

MockResourceIndex.prototype.addResource = function(resource) {
    return this.callNext('addResource', arguments);
};

MockResourceIndex.prototype.removeResource = function(resource) {
    return this.callNext('removeResource', arguments);
};

MockResourceIndex.prototype.addResourceToGroup = function(resourceID, groupName) {
    return this.callNext('addResourceToGroup', arguments);
};

MockResourceIndex.prototype.removeResourceFromGroup = function(resourceID, groupName) {
    return this.callNext('removeResourceFromGroup', arguments);
};

describe('registry.ResourceRegistry', function() {
    describe('registry.ResourceIndex#evaluateSelection', function() {
        var ResourceIndex = MockResourceIndex.extend([ ]);

        it('should return a set with one resource ID if queried by a specific ID', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'id', 'abc123' ], returns: { 'abc123': true }, async: true }
            ])).evaluateSelection(
                new selection.StringCheckNode('id', 'abc123')
            ).should.be.fulfilledWith({
                'abc123': true 
            })
        });

        it('should return a set with all resource IDs of a certain type if queried by a specific type', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def322': true }, async: true }
            ])).evaluateSelection(
                new selection.StringCheckNode('type', 'myType1')
            ).should.be.fulfilledWith({
                'abc123': true,
                'def322': true
            });
        });

        it('should return a set with all resource IDs in a certain group if queried by a specific group', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'xyz': true, 'mno': true }, async: true }
            ])).evaluateSelection(
                new selection.StringCheckNode('group', 'A/B/C')
            ).should.be.fulfilledWith({
                'xyz': true,
                'mno': true
            });
        });

        it('should return an intersection of sets if two checks are anded together', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def322': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def322': true, 'mno': true }, async: true }
            ])).evaluateSelection(
                new selection.AndNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith({
                'def322': true
            });
        });

        it('should return a union of sets if two checks are ored together', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def322': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def322': true, 'xyz': true, 'mno': true }, async: true }
            ])).evaluateSelection(
                new selection.OrNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith({
                'abc123': true,
                'def322': true,
                'xyz': true,
                'mno': true
            });
        });

        it('should return a set complement if the check is notted', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ ], returns: { 'abc123': true, 'def322': true, 'xyz': true, 'mno': true, 'asdf': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def322': true, 'xyz': true, 'mno': true }, async: true }
            ])).evaluateSelection(
                new selection.NotNode(
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith({
                'abc123': true,
                'asdf': true
            });
        });

        it('should evaluate nested expressions first', function() {
            return new registry.ResourceRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true, 'asdf': true }, async: true },
                { method: 'getResources', expectArgs: [ 'interface', 'interface1' ], returns: { 'abc123': true, 'xyz': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'interface', 'interface2' ], returns: { 'gg': true, 'hh': true, 'mm': true }, async: true },
                { method: 'getResources', expectArgs: [ 'type', 'type1' ], returns: { 'gg': true, 'hh': true }, async: true }
            ])).evaluateSelection(
                new selection.OrNode(
                    new selection.AndNode(
                        new selection.StringCheckNode('group', 'A/B/C'),
                        new selection.StringCheckNode('interface', 'interface1')
                    ),
                    new selection.AndNode(
                        new selection.StringCheckNode('interface', 'interface2'),
                        new selection.StringCheckNode('type', 'type1')
                    )
                )
            ).should.be.fulfilledWith({
                'abc123': true,
                'gg': true,
                'hh': true
            });
        });
    });
});

describe('registry.SubscriberRegistry', function() {
    describe('registry.SubscriberRegistry#isInSelection', function() {
        var ResourceIndex = MockResourceIndex.extend([ ]);

        it('should return true if the selection checks one id and that id is in the resource index', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'id', 'abc123' ], returns: { 'abc123': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('id', 'abc123')
            ).should.be.fulfilledWith(true);
        });

        it('should return true if the selection checks one type and the resource is of that type', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'type1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('type', 'type1')
            ).should.be.fulfilledWith(true);
        });

        it('should return false if the selection checks one type and the resource is not of that type', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'type1' ], returns: { 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('type', 'type1')
            ).should.be.fulfilledWith(false);
        });
    
        it('should return true if the selection checks one group and the resource is in that group', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('group', 'A/B/C')
            ).should.be.fulfilledWith(true);
        });

        it('should return false if the selection checks one group and the resource is not in that group', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('group', 'A/B/C')
            ).should.be.fulfilledWith(false);
        });

        it('should return true if the selection checks one interface and the resource is of that interface', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'interface', 'interface1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('interface', 'interface1')
            ).should.be.fulfilledWith(true);
        });

        it('should return false if the selection checks one interface and the resource is not of that interface', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'interface', 'interface1' ], returns: { 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.StringCheckNode('interface', 'interface1')
            ).should.be.fulfilledWith(false);
        });

        it('false or false -> both conditions are checked and the result is false', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.OrNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(false);
        });

        it('false or true -> both conditions are checked and the result is true', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.OrNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(true);
        });

        it('true or false -> only the first condition is checked and the result is true', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], throws: new Error('Should not be called'), async: true },
            ])).isInSelection('abc123', 
                new selection.OrNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(true);
        });

        it('true or true -> only the first condition is checked and the result is true', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { }, async: true },
            ])).isInSelection('abc123', 
                new selection.OrNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(true);
        });

        it('false and false -> only the first condition is checked and the result is false', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.AndNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(false);
        });

        it('false and true -> only the first condition is checked and the result is false', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.AndNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(false);
        });

        it('true and false -> both conditions are checked and the result is false', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { }, async: true },
            ])).isInSelection('abc123', 
                new selection.AndNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(false);
        });

        it('true and true -> both conditions are checked and the result is true', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'type', 'myType1' ], returns: { 'abc123': true, 'def': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.AndNode(
                    new selection.StringCheckNode('type', 'myType1'),
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(true);
        });

        it('not true -> result is false', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true }, async: true },
            ])).isInSelection('abc123', 
                new selection.NotNode(
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(false);
        });

        it('not false -> result is true', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { }, async: true },
            ])).isInSelection('abc123', 
                new selection.NotNode(
                    new selection.StringCheckNode('group', 'A/B/C')
                )
            ).should.be.fulfilledWith(true);
        });

        it('should evaluate nested expressions first', function() {
            return new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResources', expectArgs: [ 'group', 'A/B/C' ], returns: { 'abc123': true, 'asdf': true }, async: true },
                { method: 'getResources', expectArgs: [ 'interface', 'interface1' ], returns: { 'abc123': true, 'xyz': true, 'mno': true }, async: true },
                { method: 'getResources', expectArgs: [ 'interface', 'interface2' ], returns: { 'gg': true, 'hh': true, 'mm': true }, async: true },
                { method: 'getResources', expectArgs: [ 'type', 'type1' ], returns: { 'gg': true, 'hh': true }, async: true }
            ])).isInSelection('abc123', 
                new selection.OrNode(
                    new selection.AndNode(
                        new selection.StringCheckNode('group', 'A/B/C'),
                        new selection.StringCheckNode('interface', 'interface1')
                    ),
                    new selection.AndNode(
                        new selection.StringCheckNode('interface', 'interface2'),
                        new selection.StringCheckNode('type', 'type1')
                    )
                )
            ).should.be.fulfilledWith(true);
        });
    });

    describe('registry.SubscriberRegistry#getSubscribers', function() {
        var ResourceIndex = MockResourceIndex.extend([ ]);

        it('subscribing to specific events should only match on those events matching the selection', function() {
            var subscriberRegistry = new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true }
            ]));

            subscriberRegistry.subscribe('1', 'id="abc123"', 'event1');
            subscriberRegistry.subscribe('2', 'id="abc123"', 'event1');
            subscriberRegistry.subscribe('3', 'id="def123"', 'event2');
            subscriberRegistry.subscribe('4', 'id="abc123"', 'event1');

            return subscriberRegistry.getSubscribers('abc123', 'event1').should.be.fulfilledWith({
                '1': true,
                '2': true,
                '4': true
            });
        });

        it('subscribing to all events of a certain prefix selection', function() {
            var subscriberRegistry = new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true }
            ]));

            var s1 = subscriberRegistry.subscribe('1', 'id="abc123"', 'event1');
            var s2 = subscriberRegistry.subscribe('2', 'id="abc123"', 'event1');
            var s3 = subscriberRegistry.subscribe('3', 'id="def123"', 'event2');
            var s4 = subscriberRegistry.subscribeAll('4', 'id="abc123"', 'event-');
            var s5 = subscriberRegistry.subscribeAll('5', 'id="abc123"', 'state-');
            var s6 = subscriberRegistry.subscribe('5', 'id="abc123"', 'event1');

            return subscriberRegistry.getSubscribers('abc123', 'event1').should.be.fulfilledWith({
                '1': true,
                '2': true,
                '5': true
            }).then(function() {
                return subscriberRegistry.getSubscribers('abc123', 'event-ASDF').should.be.fulfilledWith({
                    '4': true
                });
            }).then(function() {
                return subscriberRegistry.getSubscribers('abc123', 'state-ASDF').should.be.fulfilledWith({
                    '5': true
                });
            }).then(function() {
                //subscriberRegistry.unsubscribeAll('5', 'id="abc123"', 'state-');
                subscriberRegistry.unsubscribe('5', s5);
                return subscriberRegistry.getSubscribers('abc123', 'state-ASDF').should.be.fulfilledWith({
                });
            }).then(function() {
                //subscriberRegistry.unsubscribe('5', 'id="abc123"');
            }).then(function() {
                return subscriberRegistry.getSubscribers('abc123', 'event1').should.be.fulfilledWith({
                    '1': true,
                    '2': true,
                    '5': true
                });
            }).then(function() {
                subscriberRegistry.unsubscribeAll('5');
            }).then(function() {
                return subscriberRegistry.getSubscribers('abc123', 'event1').should.be.fulfilledWith({
                    '1': true,
                    '2': true
                });
            }).then(function() {
            }).then(function() {
            })
        });
        
        it('should work', function() {
            var subscriberRegistry = new registry.SubscriberRegistry(new ResourceIndex([
                { method: 'getResourceProperties', expectArgs: [ 'abc123' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true },
                { method: 'getResourceProperties', expectArgs: [ 'xyz456' ], returns: { groups: { }, interfaces: [ ], type: 'ABC' }, async: true }
            ]));

            subscriberRegistry.subscribe('1', 'id="abc123" or id="xyz456"', 'event1');
            subscriberRegistry.subscribe('2', 'id="abc123"', 'event1');
            subscriberRegistry.subscribe('3', 'id="def123"', 'event2');
            subscriberRegistry.subscribe('4', 'id="abc123"', 'event1');
            subscriberRegistry.subscribe('5', 'id=*', 'event1');

            return subscriberRegistry.getSubscribers('abc123', 'event1').should.be.fulfilledWith({
                '1': true,
                '2': true,
                '4': true,
                '5': true
            }).then(function() {
                subscriberRegistry.getSubscribers('xyz456', 'event1').should.be.fulfilledWith({
                    '1': true
                })
            });
        })
    });
});

describe('registry.ResourceIndex', function() {
    describe('registry.ResourceIndex#getResources', function() {
        it('test get by flat properties and by all', function() {
            var resourceIndex = new registry.ResourceIndex();

            return resourceIndex.addResource({
                id: 'abc123',
                type: 'type1',
                interfaces: [ 'interface1', 'interface2' ]
            }).should.be.fulfilled().then(function() {
                return resourceIndex.addResource({
                    id: 'def123',
                    type: 'type2',
                    interfaces: [ 'interface1', 'interface2', 'interface3' ]
                }).should.be.fulfilled();
            }).then(function() {
                return resourceIndex.getResources('id', 'abc123').should.be.fulfilledWith({ 'abc123': true });
            }).then(function() {
                return resourceIndex.getResources('type', 'type1').should.be.fulfilledWith({ 'abc123': true });
            }).then(function() {
                return resourceIndex.getResources('interface', 'interface1').should.be.fulfilledWith({ 'abc123': true, 'def123': true });
            }).then(function() {
                return resourceIndex.getResources('interface', 'interface3').should.be.fulfilledWith({ 'def123': true });
            }).then(function() {
                return resourceIndex.getResources().should.be.fulfilledWith({ 'abc123': true, 'def123': true });
            }).then(function() {
                return resourceIndex.removeResource({
                    id: 'abc123',
                    type: 'type1',
                    interfaces: [ 'interface1', 'interface2' ]
                });
            }).then(function() {
                return resourceIndex.getResources('id', 'abc123').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceIndex.getResources('type', 'type1').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceIndex.getResources('interface', 'interface1').should.be.fulfilledWith({ 'def123': true });
            }).then(function() {
                return resourceIndex.getResources('interface', 'interface3').should.be.fulfilledWith({ 'def123': true });
            }).then(function() {
                return resourceIndex.getResources().should.be.fulfilledWith({ 'def123': true });
            });
        });

        it('test get by group', function() {
            var resourceIndex = new registry.ResourceIndex();

            return resourceIndex.addResource({
                id: 'abc123',
                type: 'type1',
                interfaces: [ 'interface1', 'interface2' ]
            }).then(function() {
                return resourceIndex.addResource({
                    id: 'def123',
                    type: 'type2',
                    interfaces: [ 'interface1', 'interface2', 'interface3' ]
                });
            }).then(function() {
                return resourceIndex.addResourceToGroup('abc123', 'A/B/C');
            }).then(function() {
                return resourceIndex.addResourceToGroup('def123', 'A/B');
            }).then(function() {
                return resourceIndex.addResourceToGroup('def123', 'D/E');
            }).then(function() {
                return resourceIndex.getResources('group', 'A').should.be.fulfilledWith({ 'abc123': true, 'def123': true });
            }).then(function() {
                return resourceIndex.getResources('group', 'A/B').should.be.fulfilledWith({ 'abc123': true, 'def123': true });
            }).then(function() {
                return resourceIndex.getResources('group', 'A/B/C').should.be.fulfilledWith({ 'abc123': true });
            }).then(function() {
                return resourceIndex.getResources('group', 'D').should.be.fulfilledWith({ 'def123': true });
            }).then(function() {
                return resourceIndex.getResources('group', 'D/E').should.be.fulfilledWith({ 'def123': true });
            }).then(function() {
                return resourceIndex.removeResourceFromGroup('def123', 'D/E');
            }).then(function() {
                return resourceIndex.getResources('group', 'D').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceIndex.getResources('group', 'D/E').should.be.fulfilledWith({ });
            }).then(function() {
                return resourceIndex.getResources('group', 'A').should.be.fulfilledWith({ 'abc123': true, 'def123': true });
            }).then(function() {
                return resourceIndex.removeResourceFromGroup('def123', 'D/E');
            }).then(function() {
                return resourceIndex.removeResource({
                    id: 'def123',
                    type: 'type2',
                    interfaces: [ 'interface1', 'interface2', 'interface3' ]
                });
            }).then(function() {
                return resourceIndex.getResources('group', 'A').should.be.fulfilledWith({ 'abc123': true });
            }).then(function() {
                return resourceIndex.getResources('group', 'A/B').should.be.fulfilledWith({ 'abc123': true });
            });
        });
    });
});

describe('registry.ResourceRegistry + registry.ResourceIndex', function() {
    describe('registry.ResourceRegistry#getSelection', function() {
        it('', function() {
            var resourceIndex = new registry.ResourceIndex();
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
                return resourceIndex.addResourceToGroup('abc123', 'A/B/C');
            }).then(function() {
                return resourceIndex.addResourceToGroup('def123', 'A/B');
            }).then(function() {
                return resourceIndex.addResourceToGroup('def123', 'D/E');
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
