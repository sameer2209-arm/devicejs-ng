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

const EventEmitter = require('events').EventEmitter
const validate = require('jsonschema').validate

const MinimumMonitorMapRefreshPeriod = 5000
const DefaultMonitorMapRefreshPeriod = 10000
const MinimumSampleRate = 1000
const MONITOR_PREFIX = 'devicejs.monitors'
const MONITOR_SCHEMA = {
    type: 'object',
    properties: {
        id: {
            type: 'string'
        },
        kind: {
            type: 'string',
            pattern: '^state|event$'
        },
        points: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    selection: {
                        type: [ 'string', 'null' ]
                    },
                    point: {
                        type: [ 'string', 'null' ]
                    }
                },
                required: [ 'selection', 'point' ]
            }
        },
        interval: {
            type: 'integer'
        },
        edge: {
            type: 'boolean'
        },
        version: {
            type: 'string'
        }
    },
    required: [ 'kind', 'points', 'interval', 'edge', 'id', 'version' ]
}

class MonitorMap extends EventEmitter {
    constructor(options) {
        super()

        this.monitors = new Map()
        this.ddb = options.ddb
        this.refreshPeriod = Math.max(options.refreshPeriod, MinimumMonitorMapRefreshPeriod)
        this.stopped = true
    }

    keys() {
        return this.monitors.keys()
    }

    get(monitorID) {
        return this.monitors.get(monitorID)
    }

    _addMonitor(monitor) {
        this.monitors.set(monitor.id, monitor)
        this.emit('add', monitor)
    }

    _updateMonitor(monitor) {
        this.monitors.set(monitor.id, monitor)
        this.emit('update', monitor)
    }

    _removeMonitor(monitor) {
        this.monitors.delete(monitor.id)
        this.emit('remove', monitor)
    }

    _purgeOldMonitors(currentMonitors) {
        for(let monitorID of this.monitors.keys()) {
            if(!currentMonitors.has(monitorID)) {
                this._removeMonitor(this.monitors.get(monitorID))
            }
        }
    }

    start() {
        let mergeMonitorSiblings = (siblings) => {
            return siblings[0]
        }

        let refresh = () => {
            return new Promise((resolve, reject) => {
                let monitorIDs = new Set()
                let next = (error, result) => {
                    if(this.stopped) {
                        return
                    }

                    let monitorID = result.key.substring(result.prefix.length)
                    let monitorVersion = result.context
                    let monitorBody = mergeMonitorSiblings(result.siblings)
                    let monitor

                    if(this.monitors.has(monitorID) && this.monitors.get(monitorID).version == monitorVersion) {
                        // No need to parse the body. There has been no change to this monitor
                        monitorIDs.add(monitorID)

                        return
                    }

                    try {
                        monitor = JSON.parse(monitorBody)
                    }
                    catch(error) {
                        return
                    }

                    monitor.id = monitorID
                    monitor.version = monitorVersion

                    if(!validate(monitor, MONITOR_SCHEMA).valid) {
                        return
                    }

                    monitorIDs.add(monitorID)

                    if(!this.monitors.has(monitorID)) {
                        this._addMonitor(monitor)

                        return
                    }

                    this._updateMonitor(monitor)
                }
              
                this.ddb.cloud.getMatches(MONITOR_PREFIX + '.', next).then(() => {
                    this._purgeOldMonitors(monitorIDs)
                    resolve()
                }, (error) => {
                    reject(error)
                }).then(() => {
                    if(!this.stopped) {
                        this.refreshMonitorMap = setTimeout(() => {
                            refresh()
                        }, this.refreshPeriod)
                    }
                })
            })
        }

        this.stopped = false

        return refresh()
    }

    stop() {
        this.stopped = true
        clearTimeout(this.refreshMonitorMap)
    }
}

class ResourceMonitor {
    constructor(options) {
        this.subscriberRegistry = options.subscriberRegistry
        this.ddb = options.ddb
        this.monitorMap = new MonitorMap({ 
            ddb: this.ddb,
            refreshPeriod: DefaultMonitorMapRefreshPeriod
        })
        this.stateCache = options.stateCache
        this.getState = options.getState
        this.getGroups = options.getGroups
        this.monitorMetadata = new Map()
        this.stopped = true

        this.monitorMap.on('add', (monitor) => {
            if(this.stopped) {
                return
            }

            this._addMonitor(monitor)
        }).on('remove', (monitor) => {
            if(this.stopped) {
                return
            }

            this._removeMonitor(monitor)
        }).on('update', (monitor) => {
            if(this.stopped) {
                return
            }

            this._updateMonitor(monitor)
        })
    }

    start() {
        this.stopped = false

        return this.monitorMap.start()
    }

    stop() {
        this.stopped = true
        this.monitorMap.stop()

        for(let monitorID of this.monitorMetadata.keys()) {
            this._removeMonitor({ id: monitorID })
        }
    }

    _addMonitor(monitor) {
        this._updateMonitor(monitor)
    }

    _updateMonitor(monitor) {
        // first deactivate this monitor if it already exists so it can be rebuilt
        this._removeMonitor(monitor)
        this.monitorMetadata.set(monitor.id, { subscriptions: new Set(), pollingStateMonitor: null })

        if(monitor.edge) {
            // this monitor requires edge triggers. set up subscriptions for all the points
            for(let point of monitor.points) {
                let event = monitor.kind + '-'
                let prefix = true

                if(point.point != null) {
                    event += point.point
                    prefix = false
                }

                let subscriptionID = this.subscriberRegistry.subscribe('cloud', point.selection, event, prefix)

                // associate this subscription with the monitor
                this.monitorMetadata.get(monitor.id).subscriptions.add(subscriptionID)
            }
        }

        if(monitor.interval > 0 && monitor.kind == 'state') {
            // this monitor requires a polling state monitor
            this._addPollingStateMonitor(monitor)
        }
    }

    _removeMonitor(monitor) {
        if(!this.monitorMetadata.has(monitor.id)) {
            return
        }

        let metadata = this.monitorMetadata.get(monitor.id)

        for(let subscriptionID of metadata.subscriptions) {
            this.subscriberRegistry.unsubscribe('cloud', subscriptionID)
        }

        if(metadata.pollingStateMonitor) {
            metadata.pollingStateMonitor.stop()
        }

        this.monitorMetadata.delete(monitor.id)
    }

    _addPollingStateMonitor(monitor) {
        let pollingStateMonitor = new PollingStateMonitor({
            points: monitor.points,
            samplePeriod: Math.max(monitor.interval, MinimumSampleRate),
            stateCache: this.stateCache,
            getState: this.getState
        })

        pollingStateMonitor.on('sample', (resourceID, property, value) => {
            // record sample in the ddb history log
            this.getGroups(resourceID).then((groups) => {
                this.ddb.history.log({
                    source: resourceID,
                    type: 'state-' + property,
                    data: value,
                    groups: groups
                })
            })
        })

        // associate this polling state monitor with the monitor
        this.monitorMetadata.get(monitor.id).pollingStateMonitor = pollingStateMonitor

        pollingStateMonitor.start()
    }

    // notify of a state change
    notifyStateChange(resourceID, property, state) {
        return this.notify(resourceID, 'state-' + property, state)
    }

    notifyEvent(resourceID, eventName, eventMetadata) {
        return this.notify(resourceID, 'event-' + eventName, eventMetadata)
    }

    notify(resourceID, point, pointData) {
        let shouldLog = Promise.resolve(true)

        if(this.monitorMetadata.size != 0) {
            shouldLog = this.pointHasSubscribers(resourceID, point)
        }

        return shouldLog.then((s) => {
            if(!s) {
                return
            }

            return this.getGroups(resourceID).then((groups) => {
                return this.ddb.history.log({
                    source: resourceID,
                    type: point,
                    data: pointData,
                    groups: groups
                })
            })
        })
    }

    pointHasSubscribers(resourceID, point) {
        return this.subscriberRegistry.getSubscribers(resourceID, point).then((subscribers) => { return Object.keys(subscribers).length > 0 })
    }
}

class PollingStateMonitor extends EventEmitter {
    constructor(options) {
        super()

        this.points = options.points.filter(point => point.point != null)
        this.samplePeriod = options.samplePeriod
        this.stateCache = options.stateCache
        this.getState = options.getState
        this.stopped = true
    }

    samplePoints() {
        let promises = [ ]
        let filteredPointValueMap = { }

        for(let point of this.points) {
            promises.push(this.getState(point.selection, point.point).then((result) => {
                for(let resourceID in result) {
                    filteredPointValueMap[resourceID] = filteredPointValueMap[resourceID] || { }

                    if(!result[resourceID].receivedResponse) {
                        // request timed out or device offline. cannot sample
                        continue
                    }

                    if(result[resourceID].response.error != null) {
                        // ignore error responses. no valid state data here
                        continue
                    }

                    if(point.point !== '') {
                        filteredPointValueMap[resourceID][point.point] = result[resourceID].response.result
                    }
                    else if(typeof result[resourceID].response.result === 'object' && result[resourceID].response.result !== null) {
                        filteredPointValueMap[resourceID] = result[resourceID].response.result
                    }
                }
            }, (error) => {
                // ignore errors so we get point values with best-effort
            }))
        }

        return Promise.all(promises).then(() => {
            return filteredPointValueMap
        })
    }

    start() {
        let sample = () => {
            this.sampleState = setTimeout(() => {
                this.samplePoints().then((pointValueMap) => {
                    if(this.stopped) {
                        return
                    }

                    sample()

                    let stateCacheUpdate = [ ]

                    for(let resourceID in pointValueMap) {
                        let propertyMap = pointValueMap[resourceID]

                        for(let property in propertyMap) {
                            this.emit('sample', resourceID, property, propertyMap[property])

                            stateCacheUpdate.push({
                                op: 'set',
                                resource: resourceID,
                                property: property,
                                value: propertyMap[property]
                            })
                        }
                    }

                    this.stateCache.update(stateCacheUpdate).catch((error) => {
                        console.error('Error: Unable to update state cache with sampled point values: ', error)
                    })
                })
            }, this.samplePeriod)
        }

        this.stopped = false

        sample()
    }

    stop() {
        this.stopped = true
        this.removeAllListeners()
        clearTimeout(this.sampleState)
    }
}

module.exports = {
    MonitorMap,
    ResourceMonitor,
    PollingStateMonitor,
    MONITOR_PREFIX,
    MinimumMonitorMapRefreshPeriod,
    DefaultMonitorMapRefreshPeriod
}