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
const MonitorMap = require('../src/core/resourceMonitorController').MonitorMap
const ResourceMonitor = require('../src/core/resourceMonitorController').ResourceMonitor
const PollingStateMonitor = require('../src/core/resourceMonitorController').PollingStateMonitor
const DefaultMonitorMapRefreshPeriod = require('../src/core/resourceMonitorController').DefaultMonitorMapRefreshPeriod
const SubscriberRegistry = require('../src/core/registry').SubscriberRegistry
const ResourceIndex = require('../src/core/ddbResourceIndex')
const ResourceGroupTree = require('../src/core/resourceGroupTree')

http.globalAgent.maxSockets = 1000;//Infinity; // Ensures we can send lots of http requests out at once

const DEVICEDB_PORT = 9090
const DEVICEJS_PORT = 10001
const DEVICEDB_DIRECTORY = '/tmp/testDeviceJSDB'
const MonitorMapRefreshPeriod = 5000

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

function noID(monitor) {
    let copy = JSON.parse(JSON.stringify(monitor))

    delete copy.version
    delete copy.id

    return copy
}

describe('MonitorMap', function() {
    this.timeout(60000)

    let ddbClient = newDDBClient()
    let monitorMap
    
    beforeEach(function() {
        monitorMap = new MonitorMap({
            ddb: ddbClient,
            refreshPeriod: MonitorMapRefreshPeriod
        })

        ddbClient.cloud = ddbClient.shared // so we can emulate the writes

        return ddbServer.stop().then(function() {
            return ddbServer.start()
        })
    })

    afterEach(function() {
        return monitorMap.stop()
    })

    describe('#start', function() {
        it('should load any existing monitors into the map before resolving the start() promise', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                return monitorMap.start()
            }).then(() => {
                return noID(monitorMap.get('MONITOR1')).should.be.eql(monitor1)
            }).then(() => {
                return noID(monitorMap.get('MONITOR2')).should.be.eql(monitor2)
            }).then(() => {
                return noID(monitorMap.get('MONITOR3')).should.be.eql(monitor3)
            })
        })

        it('should emit an add event for every monitor that exists when starting up' , function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                let remainingMonitors = new Map([ [ 'MONITOR1', monitor1 ], [ 'MONITOR2', monitor2 ], [ 'MONITOR3', monitor3 ] ])

                return new Promise((resolve, reject) => {
                    monitorMap.on('add', (monitor) => {
                        let expectedMonitorValue = remainingMonitors.get(monitor.id)

                        expectedMonitorValue.should.eql(noID(monitor))

                        remainingMonitors.delete(monitor.id)

                        if(remainingMonitors.size == 0) {
                            resolve()
                        }
                    }).on('remove', reject).on('update', reject)

                    monitorMap.start()
                })
            })
        })

        it('should emit an add event for every monitor that is added after starting up' , function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor4 = {
                kind: 'event',
                points: [
                    { selection: 'id="motionSensor"', point: 'motion' }
                ],
                interval: 0,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                return monitorMap.start()
            }).then(() => {
                return new Promise((resolve, reject) => {
                    monitorMap.on('add', (monitor) => {
                        noID(monitor).should.eql(monitor4)

                        resolve()
                    }).on('remove', reject).on('update', reject)

                    ddbClient.put('devicejs.monitors.MONITOR4', JSON.stringify(monitor4))
                })
            })
        })

        it('should emit an update event for every monitor that is updated after being added to the map' , function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3Modified = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'power' }
                ],
                interval: 9000,
                edge: false
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                return monitorMap.start()
            }).then(() => {
                return new Promise((resolve, reject) => {
                    monitorMap.on('update', (monitor) => {
                        noID(monitor).should.eql(monitor3Modified)

                        resolve()
                    }).on('remove', reject).on('add', reject)

                    ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3Modified))
                })
            })
        })

        it('should emit a remove event for every monitor that is removed after being added to the map' , function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                return monitorMap.start()
            }).then(() => {
                return new Promise((resolve, reject) => {
                    monitorMap.on('remove', (monitor) => {
                        noID(monitor).should.eql(monitor3)

                        resolve()
                    }).on('remove', reject).on('add', reject)

                    ddbClient.delete('devicejs.monitors.MONITOR3')
                })
            }).then(() => {
                let keys = new Set()

                for(let key of monitorMap.keys()) {
                    keys.add(key)
                }

                keys.should.eql(new Set([ 'MONITOR1', 'MONITOR2' ]))
            })
        })
    })
})

describe('ResourceMonitor', function() {
    this.timeout(60000)

    let ddbClient = newDDBClient()
    let resourceGroupTree
    let resourceIndex
    let subscriberRegistry
    let resourceMonitor
    
    beforeEach(function() {
        resourceGroupTree = new ResourceGroupTree(ddbClient)
        resourceIndex = new ResourceIndex(ddbClient, resourceGroupTree)
        subscriberRegistry = new SubscriberRegistry(resourceIndex)
        resourceMonitor = new ResourceMonitor({ subscriberRegistry: subscriberRegistry, ddb: ddbClient, stateCache: { update: () => { return Promise.resolve() } }, getState: () => { return Promise.resolve({ }) }, getGroups: () => { return Promise.resolve([ 'A/B' ]) } })

        ddbClient.cloud = ddbClient.shared // so we can emulate the writes

        return ddbServer.stop().then(function() {
            return ddbServer.start()
        })
    })

    afterEach(function() {
        return resourceMonitor.stop()
    })

    describe('#start', function() {
        it('should load any existing monitors into the map and call _addMonitor for them all', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                let remainingMonitors = new Map([ [ 'MONITOR1', monitor1 ], [ 'MONITOR2', monitor2 ], [ 'MONITOR3', monitor3 ] ])

                return new Promise((resolve, reject) => {
                    resourceMonitor._addMonitor = (monitor) => {
                        let expectedMonitorValue = remainingMonitors.get(monitor.id)

                        expectedMonitorValue.should.eql(noID(monitor))

                        remainingMonitors.delete(monitor.id)

                        if(remainingMonitors.size == 0) {
                            resolve()
                        }
                    }

                    resourceMonitor.start()
                })
            })
        })

        it('should call _removeMonitor when a monitor is deleted', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                return new Promise((resolve, reject) => {
                    resourceMonitor.start().then(() => {
                        let original = resourceMonitor._removeMonitor

                        resourceMonitor._removeMonitor = (monitor) => {
                            resourceMonitor._removeMonitor = original
                            monitor.id.should.eql('MONITOR1')
                            resolve()
                        }

                        ddbClient.delete('devicejs.monitors.MONITOR1')
                    })
                })
            })
        })
    })

    describe('#_updateMonitor', function() {
        it('should unsubscribe from old edge triggers when a monitor is updated and subscribe to new ones', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor1Updated = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'motion' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return new Promise((resolve, reject) => {
                    subscriberRegistry.unsubscribe = (subscriberID, subscriptionID) => {
                        subscriberID.should.eql('cloud')

                        subscriberRegistry.subscribe = (subscriberID, selection, event, matchEventPrefix) => {
                            subscriberID.should.eql('cloud')
                            selection.should.eql('id="hi"')
                            event.should.eql('state-motion')
                            matchEventPrefix.should.eql(false)

                            resolve()
                        }
                    }

                    ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1Updated))
                })
            })
        })

        it('should not set up subscriptions if the monitor sets edge to false', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'motion' }
                ],
                interval: 10000,
                edge: false
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1))
            ]).then(() => {
                return new Promise((resolve, reject) => {
                    subscriberRegistry.subscribe = (subscriberID, selection, event, matchEventPrefix) => {
                        reject(new Error('Subscribe was called'))
                    }

                    resourceMonitor.start().then(() => {
                        resolve()
                    })
                })
            })
        })

        it('should set up a polling state monitor if the monitor sets interval to a positive value and the kind is "state"', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'motion' }
                ],
                interval: 10000,
                edge: false
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1))
            ]).then(() => {
                return new Promise((resolve, reject) => {
                    resourceMonitor._addPollingStateMonitor = (monitor) => {
                        monitor.id.should.eql('MONITOR1')

                        resolve()
                    }

                    resourceMonitor.start()
                })
            })
        })

        it('should not set up a polling state monitor if the monitor sets interval to zero positive value', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'motion' }
                ],
                interval: 0,
                edge: false
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1))
            ]).then(() => {
                return new Promise((resolve, reject) => {
                    resourceMonitor._addPollingStateMonitor = (monitor) => {
                        resolve(new Error('_addPollingStateMonitor called'))
                    }

                    resourceMonitor.start().then(() => {
                        resolve()
                    })
                })
            })
        })

        it('should not set up a polling state monitor if the monitor is kind "event"', function() {
            let monitor1 = {
                kind: 'event',
                points: [
                    { selection: 'id="hi"', point: 'motion' }
                ],
                interval: 1000,
                edge: false
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1))
            ]).then(() => {
                return new Promise((resolve, reject) => {
                    resourceMonitor._addPollingStateMonitor = (monitor) => {
                        resolve(new Error('_addPollingStateMonitor called'))
                    }

                    resourceMonitor.start().then(() => {
                        resolve()
                    })
                })
            })
        })
    })

    describe('#stop', function() {
        it('should shutdown any existing monitors by calling _removeMonitor for them all', function() {
            let monitor1 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor2 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            let monitor3 = {
                kind: 'state',
                points: [
                    { selection: 'id="hi"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR1', JSON.stringify(monitor1)),
                ddbClient.put('devicejs.monitors.MONITOR2', JSON.stringify(monitor2)),
                ddbClient.put('devicejs.monitors.MONITOR3', JSON.stringify(monitor3))
            ]).then(() => {
                let remainingMonitors = new Set([ 'MONITOR1', 'MONITOR2', 'MONITOR3' ])

                return new Promise((resolve, reject) => {
                    resourceMonitor._removeMonitor = (monitor) => {
                        remainingMonitors.delete(monitor.id)

                        if(remainingMonitors.size == 0) {
                            resolve()
                        }
                    }

                    resourceMonitor.start().then(() => {
                        resourceMonitor.stop()
                    })
                })
            })
        })
    })

    describe('#pointHasSubscribers', function() {
        it('should return true if there is a monitor where the resource is included in the selection and the state property is an exact match', function() {
            let monitor = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: 'asdf' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR', JSON.stringify(monitor))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'state-asdf').should.be.fulfilledWith(true)
            })
        })

        it('should return true if there is a monitor where the resource is included in the selection and the state property is a wildcard', function() {
            let monitor = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: null }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR', JSON.stringify(monitor))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'state-asdf').should.be.fulfilledWith(true)
            })
        })

        it('should return true if there is are monitors where the resource is included in the selection but the state property is not specified directly nor included in a wildcard', function() {
            let monitor = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: 'aaa' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR', JSON.stringify(monitor))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'state-asdf').should.be.fulfilledWith(false)
            })
        })

        it('should allow both event and state point subscribers', function() {
            let monitorState = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: 'aaa' }
                ],
                interval: 10000,
                edge: true
            }

            let monitorEvent = {
                kind: 'event',
                points: [
                    { selection: 'id="device1"', point: 'motion' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITORSTATE', JSON.stringify(monitorState)),
                ddbClient.put('devicejs.monitors.MONITOREVENT', JSON.stringify(monitorEvent))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'state-aaa').should.be.fulfilledWith(true)
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'event-motion').should.be.fulfilledWith(true)
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'state-motion').should.be.fulfilledWith(false)
            }).then(() => {
                return resourceMonitor.pointHasSubscribers('device1', 'event-aaa').should.be.fulfilledWith(false)
            })
        })
    })

    describe('#notify', function() {
        it('should record points to the history if there is an edge trigger monitor set up for it', function() {
            let monitor = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: 'power' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR', JSON.stringify(monitor))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-power', 'on')
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-power', 'off')
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-power', 'on')
            }).then(() => {
                let points = [ ]

                return new Promise((resolve, reject) => {
                    ddbClient.history.query({ }, (error, result) => {
                        if(error) {
                            reject(error)

                            return
                        }

                        delete result.timestamp
                        delete result.serial
                        delete result.uuid

                        points.push(result)
                    }).then(() => {
                        resolve(points)
                    }, (error) => {
                        reject(error)
                    })
                })
            }).then((points) => {
                points.should.be.eql([
                    { source: 'device1', type: 'state-power', data: '"on"', groups: [ 'A/B' ] },
                    { source: 'device1', type: 'state-power', data: '"off"', groups: [ 'A/B' ] },
                    { source: 'device1', type: 'state-power', data: '"on"', groups: [ 'A/B' ] }
                ])
            })
        })

        it('should ignore points if there are no edge trigger monitors set up for it', function() {
            let monitor = {
                kind: 'state',
                points: [
                    { selection: 'id="device1"', point: 'power' }
                ],
                interval: 10000,
                edge: true
            }

            return Promise.all([
                ddbClient.put('devicejs.monitors.MONITOR', JSON.stringify(monitor))
            ]).then(() => {
                return resourceMonitor.start()
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.45)
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.55)
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.99)
            }).then(() => {
                let points = [ ]

                return new Promise((resolve, reject) => {
                    ddbClient.history.query({ }, (error, result) => {
                        if(error) {
                            reject(error)

                            return
                        }

                        delete result.timestamp
                        delete result.serial
                        delete result.uuid

                        points.push(result)
                    }).then(() => {
                        resolve(points)
                    }, (error) => {
                        reject(error)
                    })
                })
            }).then((points) => {
                points.should.be.eql([ ])
            })
        })

        it('should write all points to history if there are no monitors set up at all in order to be compatible by default with the old history', function() {
            return resourceMonitor.start().then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.45)
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.55)
            }).then(() => {
                return resourceMonitor.notify('device1', 'state-brightness', 0.99)
            }).then(() => {
                let points = [ ]

                return new Promise((resolve, reject) => {
                    ddbClient.history.query({ }, (error, result) => {
                        if(error) {
                            reject(error)

                            return
                        }

                        delete result.timestamp
                        delete result.serial
                        delete result.uuid

                        points.push(result)
                    }).then(() => {
                        resolve(points)
                    }, (error) => {
                        reject(error)
                    })
                })
            }).then((points) => {
                points.should.be.eql([
                    { source: 'device1', type: 'state-brightness', data: '0.45', groups: [ 'A/B' ] },
                    { source: 'device1', type: 'state-brightness', data: '0.55', groups: [ 'A/B' ] },
                    { source: 'device1', type: 'state-brightness', data: '0.99', groups: [ 'A/B' ] }
                ])
            })
        })
    })
})

describe('PollingStateMonitor', function() {
    this.timeout(60000)

    describe('#start', function() {
        it('should emit a "sample" event for every sampled point that responded successfully when the scheduled sample happens', function() {
            let callNumber = -1
            let pollingStateMonitor = new PollingStateMonitor({ 
                samplePeriod: 1000,
                stateCache: { update: () => { return Promise.resolve() } },
                getState: () => {
                    callNumber += 1

                    if(callNumber == 0) {
                        return Promise.resolve({
                            device1: {
                                receivedResponse: true,
                                response: {
                                    error: null,
                                    result: 'on'
                                }
                            }
                        })
                    }

                    if(callNumber == 1) {
                        return Promise.resolve({
                            device1: {
                                receivedResponse: true,
                                response: {
                                    error: 'An error occurred. Unable to retrieve power state'
                                }
                            }
                        })
                    }

                    if(callNumber == 2) {
                        return Promise.resolve({
                            device1: {
                                receivedResponse: false,
                                response: null
                            }
                        })
                    }
                },
                points: [ { selection: 'id="device1"', point: 'power' } ]
            })

            let sampleEvents = 0
            pollingStateMonitor.start()

            return new Promise((resolve, reject) => {
                pollingStateMonitor.on('sample', (resourceID, property, value) => {
                    if(sampleEvents != 0) {
                        reject(new Error('Sample event happened more than once'))
                    }

                    sampleEvents++
                })

                // wait enough time for the sample to happen three times
                setTimeout(() => {
                    // stop the polling monitor to make sure no more samples are taken
                    pollingStateMonitor.stop()

                    setTimeout(() => {
                        callNumber.should.eql(2)
                        sampleEvents.should.eql(1)

                        resolve()
                    }, 2000)
                }, 3500)
            })
        })
    })
})

let TestMotionInterfaceSchema = {
    name: 'TestMotionInterface',
    version: '0.0.1',
    commands: { },
    state: { },
    events: {
        motion: {
            schema: { type: 'boolean' }
        }
    }
}

let TestPowerInterfaceSchema = {
    name: 'TestPowerInterface',
    version: '0.0.1',
    commands: { },
    state: { 
        power: {
            readOnly: false,
            schema: { type: 'string' }
        }
    },
    events: { }
}

let VirtualLightSchema = {
    name: 'VirtualLight',
    version: '0.0.1',
    interfaces: [ 'TestPowerInterface' ]
}

let VirtualMotionSensorSchema = {
    name: 'VirtualMotionSensor',
    version: '0.0.1',
    interfaces: [ 'TestMotionInterface' ]
}

let VirtualLightController = {
    start: function() {
        this.power = 'off'
    },
    stop: function() {
    },
    state: {
        power: {
            get: function() {
                return this.power
            },
            set: function(p) {
                this.power = p
            }
        }
    }
}

let VirtualMotionSensorController = {
    start: function() {
    },
    stop: function() {
    }
}

describe('ResourceMonitor Integration Tests', function() {
    this.timeout(60000)

    let ddbClient = newDDBClient()

    beforeEach(function() {
        ddbClient.cloud = ddbClient.shared // so we can emulate the writes
        return ddbServer.stop().then(function() {
            return ddbServer.start()
        }).then(function() {
            coreServer._ddb.cloud = coreServer._ddb.shared

            return coreServer.start()
        })
    })

    afterEach(function() {
        return coreServer.stop()
    })

    it('should sample the state of resources specified in monitors at fixed rates and record edge events', function() {
        let djsClient = newDJSClient()
        let VirtualMotionSensor = djsClient.resource('VirtualMotionSensor', VirtualMotionSensorController)
        let VirtualLight = djsClient.resource('VirtualLight', VirtualLightController)
        let motion1 = new VirtualMotionSensor('motion1')
        let light1 = new VirtualLight('light1')
        let light1Monitor = {
            kind: 'state',
            points: [
                { selection: 'id="light1"', point: 'power' }
            ],
            interval: 1000,
            edge: true
        }

        let motion1Monitor = {
            kind: 'event',
            points: [
                { selection: 'id="motion1"', point: 'motion' }
            ],
            interval: 0,
            edge: true
        }

        return djsClient.connect().then(() => {
            return djsClient.addInterfaceType(TestMotionInterfaceSchema)
        }).then(() => {
            return djsClient.addInterfaceType(TestPowerInterfaceSchema)
        }).then(() => {
            return djsClient.addResourceType(VirtualLightSchema)
        }).then(() => {
            return djsClient.addResourceType(VirtualMotionSensorSchema)
        }).then(() => {
            return motion1.start()
        }).then(() => {
            return light1.start()
        }).then(() => {
            return djsClient.joinResourceGroup('motion1', 'A/B/C')
        }).then(() => {
            return djsClient.joinResourceGroup('light1', 'X/Y/Z')
        }).then(() => {
            return ddbClient.put('devicejs.monitors.LIGHT1MONITOR', JSON.stringify(light1Monitor))
        }).then(() => {
            return ddbClient.put('devicejs.monitors.MOTION1MONITOR', JSON.stringify(motion1Monitor))
        }).then(() => {
            // wait long enough for the monitor to be picked up by the resource monitor controller
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve()
                }, DefaultMonitorMapRefreshPeriod + 1000)
            })
        }).then(() => {
            motion1.emit('motion', true)
            // wait long enough for the monitor to poll the light at least three times
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    resolve()
                }, 4000)
            })
        }).then(() => {
            let points = [ ]

            return new Promise((resolve, reject) => {
                ddbClient.history.query({ }, (error, result) => {
                    if(error) {
                        reject(error)

                        return
                    }

                    delete result.timestamp
                    delete result.serial
                    delete result.uuid

                    points.push(result)
                }).then(() => {
                    resolve(points)
                }, (error) => {
                    console.log(error)
                    reject(error)
                })
            })
        }).then((points) => {
            // ensure that there is exactly one recorded motion event and at least 3 sampled power state values
            points.length.should.be.aboveOrEqual(4)

            let motionEventIndex = -1

            for(let i = 0; i < points.length; i++) {
                let point = points[i]

                if(point.source == 'motion1') {
                    motionEventIndex.should.eql(-1)
                    motionEventIndex = i
                    point.should.eql({ source: 'motion1', type: 'event-motion', data: 'true', groups: [ 'A/B/C' ] })
                }
                else {
                    point.should.eql({ source: 'light1', type: 'state-power', data: '"off"', groups: [ 'X/Y/Z' ] })
                }
            }

            motionEventIndex.should.not.eql(-1)
        }).then(() => {
            return motion1.stop()
        }).then(() => {
            return light1.stop()
        }).then(() => {
            return djsClient.disconnect()
        })
    })

    it('should record all edge triggered points to the history if no monitors have been created', function() {
        let djsClient = newDJSClient()
        let VirtualMotionSensor = djsClient.resource('VirtualMotionSensor', VirtualMotionSensorController)
        let VirtualLight = djsClient.resource('VirtualLight', VirtualLightController)
        let motion1 = new VirtualMotionSensor('motion1')
        let light1 = new VirtualLight('light1')

        return djsClient.connect().then(() => {
            return djsClient.addInterfaceType(TestMotionInterfaceSchema)
        }).then(() => {
            return djsClient.addInterfaceType(TestPowerInterfaceSchema)
        }).then(() => {
            return djsClient.addResourceType(VirtualLightSchema)
        }).then(() => {
            return djsClient.addResourceType(VirtualMotionSensorSchema)
        }).then(() => {
            return motion1.start()
        }).then(() => {
            return light1.start()
        }).then(() => {
            return djsClient.joinResourceGroup('motion1', 'A/B/C')
        }).then(() => {
            return djsClient.joinResourceGroup('light1', 'X/Y/Z')
        }).then(() => {
            // wait long enough for the monitor to be picked up by the resource monitor controller
        }).then(() => {
            motion1.emit('motion', true)
        }).then(() => {
            return djsClient.select('id="light1"').set('power', 'on')
        }).then(() => {
            let points = [ ]

            return new Promise((resolve, reject) => {
                ddbClient.history.query({ }, (error, result) => {
                    if(error) {
                        reject(error)

                        return
                    }

                    delete result.timestamp
                    delete result.serial
                    delete result.uuid

                    points.push(result)
                }).then(() => {
                    resolve(points)
                }, (error) => {
                    console.log(error)
                    reject(error)
                })
            })
        }).then((points) => {
            // ensure that there is exactly one recorded motion event and at least 3 sampled power state values
            points.length.should.be.eql(2)

            let motionEventIndex = -1

            for(let i = 0; i < points.length; i++) {
                let point = points[i]

                if(point.source == 'motion1') {
                    motionEventIndex.should.eql(-1)
                    motionEventIndex = i
                    point.should.eql({ source: 'motion1', type: 'event-motion', data: 'true', groups: [ 'A/B/C' ] })
                }
                else {
                    point.should.eql({ source: 'light1', type: 'state-power', data: '"on"', groups: [ 'X/Y/Z' ] })
                }
            }

            motionEventIndex.should.not.eql(-1)
        }).then(() => {
            return motion1.stop()
        }).then(() => {
            return light1.stop()
        }).then(() => {
            return djsClient.disconnect()
        })
    })
})